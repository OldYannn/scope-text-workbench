use serde_json::{json, Value};
use std::collections::HashMap;
use std::fmt;
use std::io::{BufRead, BufReader, Write};
#[cfg(any(debug_assertions, test))]
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex, MutexGuard};
use std::thread;

#[derive(Clone)]
pub struct CommandSpec {
    executable: String,
    arguments: Vec<String>,
    environment: Vec<(String, String)>,
    unavailable_reason: Option<String>,
}

impl CommandSpec {
    #[cfg(any(debug_assertions, test))]
    pub fn python(executable: impl Into<String>, source_path: PathBuf) -> Self {
        Self {
            executable: executable.into(),
            arguments: vec!["-u".into(), "-m".into(), "scope_engine".into()],
            environment: vec![(
                "PYTHONPATH".into(),
                source_path.to_string_lossy().into_owned(),
            )],
            unavailable_reason: None,
        }
    }

    #[cfg(debug_assertions)]
    pub fn for_current_build() -> Self {
        let repository_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..");
        #[cfg(windows)]
        let executable = repository_root.join(".venv/Scripts/python.exe");
        #[cfg(not(windows))]
        let executable = repository_root.join(".venv/bin/python");
        Self::python(
            executable.to_string_lossy(),
            repository_root.join("engine/src"),
        )
    }

    #[cfg(not(debug_assertions))]
    pub fn for_current_build() -> Self {
        let executable_name = if cfg!(windows) {
            "scope-engine-dev.exe"
        } else {
            "scope-engine-dev"
        };
        match std::env::current_exe().ok().and_then(|current_exe| {
            current_exe
                .parent()
                .map(|parent| parent.join(executable_name))
        }) {
            Some(executable) => Self {
                executable: executable.to_string_lossy().into_owned(),
                arguments: Vec::new(),
                environment: Vec::new(),
                unavailable_reason: None,
            },
            None => Self {
                executable: String::new(),
                arguments: Vec::new(),
                environment: Vec::new(),
                unavailable_reason: Some(
                    "Packaged Python sidecar location could not be resolved".into(),
                ),
            },
        }
    }
}

#[derive(Debug)]
pub struct SupervisorError(String);

impl fmt::Display for SupervisorError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

struct ManagedProcess {
    generation: u64,
    child: Child,
    stdin: ChildStdin,
}

#[derive(Default)]
struct SharedState {
    generation: u64,
    process: Option<ManagedProcess>,
    pending: HashMap<String, mpsc::Sender<Value>>,
}

pub struct EngineSupervisor {
    command: CommandSpec,
    state: Arc<Mutex<SharedState>>,
}

impl EngineSupervisor {
    pub fn new(command: CommandSpec) -> Self {
        Self {
            command,
            state: Arc::new(Mutex::new(SharedState::default())),
        }
    }

    pub fn request(&self, request: Value) -> Result<mpsc::Receiver<Value>, SupervisorError> {
        let request_id = request
            .get("request_id")
            .and_then(Value::as_str)
            .filter(|request_id| !request_id.is_empty())
            .ok_or_else(|| SupervisorError("request_id must be a non-empty string".into()))?
            .to_owned();
        let line = serde_json::to_string(&request)
            .map_err(|error| SupervisorError(format!("cannot serialize request: {error}")))?;
        let (sender, receiver) = mpsc::channel();
        let mut state = lock_state(&self.state);
        self.ensure_started(&mut state)?;
        if state.pending.contains_key(&request_id) {
            return Err(SupervisorError(format!(
                "request_id is already pending: {request_id}"
            )));
        }
        state.pending.insert(request_id.clone(), sender);
        let write_result = state
            .process
            .as_mut()
            .expect("engine is started")
            .stdin
            .write_all(format!("{line}\n").as_bytes())
            .and_then(|_| {
                state
                    .process
                    .as_mut()
                    .expect("engine is started")
                    .stdin
                    .flush()
            });
        if let Err(error) = write_result {
            state.pending.remove(&request_id);
            stop_process(state.process.take());
            fail_pending(
                &mut state,
                "engine_exited",
                "Python engine connection failed while writing a request",
            );
            return Err(SupervisorError(format!(
                "cannot write request to engine: {error}"
            )));
        }
        Ok(receiver)
    }

    fn ensure_started(
        &self,
        state: &mut MutexGuard<'_, SharedState>,
    ) -> Result<(), SupervisorError> {
        if let Some(reason) = &self.command.unavailable_reason {
            return Err(SupervisorError(reason.clone()));
        }
        let has_running_process = match state.process.as_mut() {
            Some(process) => match process.child.try_wait() {
                Ok(None) => true,
                Ok(Some(_)) => false,
                Err(_) => false,
            },
            None => false,
        };
        if has_running_process {
            return Ok(());
        }

        if state.process.is_some() {
            stop_process(state.process.take());
            fail_pending(state, "engine_exited", "Python engine exited unexpectedly");
        }

        let mut command = Command::new(&self.command.executable);
        command
            .args(&self.command.arguments)
            .env_remove("PYTHONHOME")
            .env_remove("PYTHONPATH")
            .envs(self.command.environment.iter().cloned())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let mut child = command.spawn().map_err(|error| {
            SupervisorError(format!(
                "cannot start Python engine '{}': {error}",
                self.command.executable
            ))
        })?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| SupervisorError("Python engine stdin is unavailable".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| SupervisorError("Python engine stdout is unavailable".into()))?;
        state.generation += 1;
        let generation = state.generation;
        state.process = Some(ManagedProcess {
            generation,
            child,
            stdin,
        });

        let shared_state = Arc::clone(&self.state);
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                match line {
                    Ok(line) => match serde_json::from_str::<Value>(&line) {
                        Ok(message) => route_message(&shared_state, generation, message),
                        Err(_) => {
                            fail_generation(
                                &shared_state,
                                generation,
                                "engine_protocol_error",
                                "Python engine emitted invalid JSON",
                            );
                            return;
                        }
                    },
                    Err(_) => break,
                }
            }
            fail_generation(
                &shared_state,
                generation,
                "engine_exited",
                "Python engine exited unexpectedly",
            );
        });
        Ok(())
    }
}

impl Drop for EngineSupervisor {
    fn drop(&mut self) {
        let mut state = lock_state(&self.state);
        stop_process(state.process.take());
        fail_pending(
            &mut state,
            "engine_stopped",
            "Python engine supervisor stopped",
        );
    }
}

fn lock_state(state: &Arc<Mutex<SharedState>>) -> MutexGuard<'_, SharedState> {
    state
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn route_message(state: &Arc<Mutex<SharedState>>, generation: u64, message: Value) {
    let Some(request_id) = message.get("request_id").and_then(Value::as_str) else {
        return;
    };
    let terminal = matches!(
        message.get("type").and_then(Value::as_str),
        Some("result" | "error")
    );
    let sender = {
        let mut state = lock_state(state);
        if state.process.as_ref().map(|process| process.generation) != Some(generation) {
            return;
        }
        if terminal {
            state.pending.remove(request_id)
        } else {
            state.pending.get(request_id).cloned()
        }
    };
    if let Some(sender) = sender {
        let _ = sender.send(message);
    }
}

fn fail_generation(state: &Arc<Mutex<SharedState>>, generation: u64, code: &str, message: &str) {
    let mut state = lock_state(state);
    if state.process.as_ref().map(|process| process.generation) != Some(generation) {
        return;
    }
    stop_process(state.process.take());
    fail_pending(&mut state, code, message);
}

fn fail_pending(state: &mut SharedState, code: &str, message: &str) {
    for (request_id, sender) in state.pending.drain() {
        let _ = sender.send(json!({
            "protocol_version": "0.1",
            "request_id": request_id,
            "type": "error",
            "error": {"code": code, "message": message, "details": {}}
        }));
    }
}

fn stop_process(process: Option<ManagedProcess>) {
    if let Some(mut process) = process {
        let _ = process.child.kill();
        let _ = process.child.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::{CommandSpec, EngineSupervisor};
    use serde_json::{json, Value};
    use std::path::PathBuf;
    use std::time::Duration;

    fn supervisor() -> EngineSupervisor {
        let source = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../engine/src");
        let executable = if cfg!(windows) { "python" } else { "python3" };
        EngineSupervisor::new(CommandSpec::python(executable, source))
    }

    fn receive(receiver: &std::sync::mpsc::Receiver<Value>) -> Value {
        receiver
            .recv_timeout(Duration::from_secs(3))
            .expect("engine response")
    }

    #[test]
    fn routes_progress_and_terminal_result() {
        let supervisor = supervisor();
        let receiver = supervisor
            .request(json!({
                "protocol_version": "0.1",
                "request_id": "rust-diagnostic-1",
                "method": "diagnostic.run",
                "params": {"steps": 2, "delay_ms": 0}
            }))
            .expect("request accepted");

        assert_eq!(receive(&receiver)["type"], "progress");
        assert_eq!(receive(&receiver)["type"], "progress");
        let terminal = receive(&receiver);
        assert_eq!(terminal["type"], "result");
        assert_eq!(terminal["result"]["completed_steps"], 2);
    }

    #[test]
    fn routes_cancellation_to_the_target_request() {
        let supervisor = supervisor();
        let running = supervisor
            .request(json!({
                "protocol_version": "0.1",
                "request_id": "rust-cancel-target",
                "method": "diagnostic.run",
                "params": {"steps": 5, "delay_ms": 200}
            }))
            .expect("diagnostic accepted");
        assert_eq!(receive(&running)["type"], "progress");

        let cancellation = supervisor
            .request(json!({
                "protocol_version": "0.1",
                "request_id": "rust-cancel-1",
                "method": "request.cancel",
                "params": {"target_request_id": "rust-cancel-target"}
            }))
            .expect("cancellation accepted");

        assert_eq!(receive(&cancellation)["result"]["accepted"], true);
        let cancelled = receive(&running);
        assert_eq!(cancelled["type"], "error");
        assert_eq!(cancelled["error"]["code"], "cancelled");
    }

    #[test]
    fn write_failure_terminates_requests_already_waiting_on_the_process() {
        let executable = if cfg!(windows) { "python" } else { "python3" };
        let script = concat!(
            "import json,os,sys,time; ",
            "request=json.loads(sys.stdin.readline()); ",
            "os.close(0); ",
            "print(json.dumps({'protocol_version':'0.1','request_id':request['request_id'],",
            "'type':'progress','progress':{'current':1,'total':2,'message':'ready'}}),flush=True); ",
            "time.sleep(3)"
        );
        let supervisor = EngineSupervisor::new(CommandSpec {
            executable: executable.into(),
            arguments: vec!["-u".into(), "-c".into(), script.into()],
            environment: Vec::new(),
            unavailable_reason: None,
        });
        let waiting = supervisor
            .request(json!({
                "protocol_version": "0.1",
                "request_id": "waiting-before-broken-pipe",
                "method": "diagnostic.run",
                "params": {"steps": 2, "delay_ms": 0}
            }))
            .expect("first request accepted");
        assert_eq!(receive(&waiting)["type"], "progress");
        std::thread::sleep(Duration::from_millis(50));

        let write_error = supervisor.request(json!({
            "protocol_version": "0.1",
            "request_id": "broken-pipe-trigger",
            "method": "system.describe",
            "params": {}
        }));
        assert!(write_error.is_err());
        let terminal = receive(&waiting);
        assert_eq!(terminal["type"], "error");
        assert_eq!(terminal["error"]["code"], "engine_exited");
    }

    #[test]
    fn reports_exit_and_restarts_only_for_next_request() {
        let supervisor = supervisor();
        let crashed = supervisor
            .request(json!({
                "protocol_version": "0.1",
                "request_id": "rust-crash-1",
                "method": "diagnostic.crash",
                "params": {}
            }))
            .expect("crash request accepted");

        let exit = receive(&crashed);
        assert_eq!(exit["type"], "error");
        assert_eq!(exit["error"]["code"], "engine_exited");

        let restarted = supervisor
            .request(json!({
                "protocol_version": "0.1",
                "request_id": "rust-describe-after-crash",
                "method": "system.describe",
                "params": {}
            }))
            .expect("new request starts a fresh engine");
        assert_eq!(receive(&restarted)["type"], "result");
    }
}

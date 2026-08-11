mod engine_supervisor;

use engine_supervisor::{CommandSpec, EngineSupervisor};
use serde_json::{json, Value};
use std::sync::mpsc;
use tauri::{Emitter, State};

fn receive_terminal(
    receiver: mpsc::Receiver<Value>,
    app: Option<tauri::AppHandle>,
) -> Result<Value, String> {
    for message in receiver {
        match message.get("type").and_then(Value::as_str) {
            Some("progress") => {
                if let Some(app) = &app {
                    app.emit("engine-progress", message.clone())
                        .map_err(|error| error.to_string())?;
                }
            }
            Some("result" | "error") => return Ok(message),
            _ => return Err("Python engine returned an unknown message type".into()),
        }
    }
    Err("Python engine response channel closed unexpectedly".into())
}

async fn dispatch(
    supervisor: &EngineSupervisor,
    app: Option<tauri::AppHandle>,
    request: Value,
) -> Result<Value, String> {
    let receiver = supervisor
        .request(request)
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || receive_terminal(receiver, app))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn engine_describe(
    supervisor: State<'_, EngineSupervisor>,
    request_id: String,
) -> Result<Value, String> {
    dispatch(
        &supervisor,
        None,
        json!({
            "protocol_version": "0.1",
            "request_id": request_id,
            "method": "system.describe",
            "params": {}
        }),
    )
    .await
}

#[tauri::command]
async fn diagnostic_run(
    app: tauri::AppHandle,
    supervisor: State<'_, EngineSupervisor>,
    request_id: String,
    steps: u8,
    delay_ms: u16,
) -> Result<Value, String> {
    dispatch(
        &supervisor,
        Some(app),
        json!({
            "protocol_version": "0.1",
            "request_id": request_id,
            "method": "diagnostic.run",
            "params": {"steps": steps, "delay_ms": delay_ms}
        }),
    )
    .await
}

#[tauri::command]
async fn diagnostic_cancel(
    supervisor: State<'_, EngineSupervisor>,
    request_id: String,
    target_request_id: String,
) -> Result<Value, String> {
    dispatch(
        &supervisor,
        None,
        json!({
            "protocol_version": "0.1",
            "request_id": request_id,
            "method": "request.cancel",
            "params": {"target_request_id": target_request_id}
        }),
    )
    .await
}

#[tauri::command]
async fn diagnostic_crash(
    supervisor: State<'_, EngineSupervisor>,
    request_id: String,
) -> Result<Value, String> {
    dispatch(
        &supervisor,
        None,
        json!({
            "protocol_version": "0.1",
            "request_id": request_id,
            "method": "diagnostic.crash",
            "params": {}
        }),
    )
    .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(feature = "e2e")]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());

    builder
        .manage(EngineSupervisor::new(CommandSpec::for_current_build()))
        .invoke_handler(tauri::generate_handler![
            engine_describe,
            diagnostic_run,
            diagnostic_cancel,
            diagnostic_crash
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

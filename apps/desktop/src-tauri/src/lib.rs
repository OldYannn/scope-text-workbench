mod engine_supervisor;

use engine_supervisor::{CommandSpec, EngineSupervisor};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::{mpsc, Mutex},
};
use tauri::{Emitter, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
struct ApprovedPaths {
    project_parents: Mutex<HashSet<PathBuf>>,
    projects: Mutex<HashSet<PathBuf>>,
    sources: Mutex<HashSet<PathBuf>>,
}

impl ApprovedPaths {
    fn canonical(path: impl AsRef<Path>) -> Result<PathBuf, String> {
        std::fs::canonicalize(path).map_err(|_| "The selected path is no longer available".into())
    }

    fn insert(set: &Mutex<HashSet<PathBuf>>, path: impl AsRef<Path>) -> Result<String, String> {
        let canonical = Self::canonical(path)?;
        set.lock()
            .map_err(|_| "Path approval state is unavailable".to_string())?
            .insert(canonical.clone());
        Ok(canonical.to_string_lossy().into_owned())
    }

    fn require(set: &Mutex<HashSet<PathBuf>>, path: impl AsRef<Path>) -> Result<(), String> {
        let supplied = path.as_ref();
        let approvals = set
            .lock()
            .map_err(|_| "Path approval state is unavailable".to_string())?;
        if approvals.contains(supplied) {
            Ok(())
        } else {
            drop(approvals);
            let canonical = Self::canonical(supplied)?;
            if set
                .lock()
                .map_err(|_| "Path approval state is unavailable".to_string())?
                .contains(&canonical)
            {
                Ok(())
            } else {
                Err("The path was not approved by the system file picker".into())
            }
        }
    }

    fn approve_parent(&self, path: impl AsRef<Path>) -> Result<String, String> {
        Self::insert(&self.project_parents, path)
    }

    fn approve_project(&self, path: impl AsRef<Path>) -> Result<String, String> {
        Self::insert(&self.projects, path)
    }

    fn approve_created_project(&self, path: impl AsRef<Path>) -> Result<String, String> {
        let supplied = path.as_ref().to_path_buf();
        let approved = Self::canonical(&supplied).unwrap_or(supplied);
        self.projects
            .lock()
            .map_err(|_| "Path approval state is unavailable".to_string())?
            .insert(approved.clone());
        Ok(approved.to_string_lossy().into_owned())
    }

    fn approve_source(&self, path: impl AsRef<Path>) -> Result<String, String> {
        Self::insert(&self.sources, path)
    }

    fn require_parent(&self, path: impl AsRef<Path>) -> Result<(), String> {
        Self::require(&self.project_parents, path)
    }

    fn require_project(&self, path: impl AsRef<Path>) -> Result<(), String> {
        Self::require(&self.projects, path)
    }

    fn require_source(&self, path: impl AsRef<Path>) -> Result<(), String> {
        Self::require(&self.sources, path)
    }
}

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

#[tauri::command]
async fn project_create(
    supervisor: State<'_, EngineSupervisor>,
    approved: State<'_, ApprovedPaths>,
    request_id: String,
    name: String,
    parent_path: String,
) -> Result<Value, String> {
    approved.require_parent(&parent_path)?;
    let response = dispatch(
        &supervisor,
        None,
        json!({
            "protocol_version": "0.1",
            "request_id": request_id,
            "method": "project.create",
            "params": {"name": name, "parent_path": parent_path}
        }),
    )
    .await?;
    if let Some(project_path) = response
        .pointer("/result/project/project_path")
        .and_then(Value::as_str)
    {
        // The trusted local engine has just created this path. Some Windows
        // verbatim paths cannot be canonicalized a second time even though
        // they exist, so retain the exact engine-returned path as a fallback.
        approved.approve_created_project(project_path)?;
    }
    Ok(response)
}

#[tauri::command]
async fn project_open(
    supervisor: State<'_, EngineSupervisor>,
    approved: State<'_, ApprovedPaths>,
    request_id: String,
    project_path: String,
) -> Result<Value, String> {
    approved.require_project(&project_path)?;
    dispatch(
        &supervisor,
        None,
        json!({
            "protocol_version": "0.1",
            "request_id": request_id,
            "method": "project.open",
            "params": {"project_path": project_path}
        }),
    )
    .await
}

#[tauri::command]
async fn corpus_import_txt(
    supervisor: State<'_, EngineSupervisor>,
    approved: State<'_, ApprovedPaths>,
    request_id: String,
    project_path: String,
    file_paths: Vec<String>,
) -> Result<Value, String> {
    approved.require_project(&project_path)?;
    for file_path in &file_paths {
        approved.require_source(file_path)?;
    }
    dispatch(
        &supervisor,
        None,
        json!({
            "protocol_version": "0.1",
            "request_id": request_id,
            "method": "corpus.import_txt",
            "params": {"project_path": project_path, "file_paths": file_paths}
        }),
    )
    .await
}

#[tauri::command]
async fn document_get(
    supervisor: State<'_, EngineSupervisor>,
    approved: State<'_, ApprovedPaths>,
    request_id: String,
    project_path: String,
    document_id: String,
) -> Result<Value, String> {
    approved.require_project(&project_path)?;
    dispatch(
        &supervisor,
        None,
        json!({
            "protocol_version": "0.1",
            "request_id": request_id,
            "method": "document.get",
            "params": {"project_path": project_path, "document_id": document_id}
        }),
    )
    .await
}

#[tauri::command]
async fn select_project_parent(
    app: tauri::AppHandle,
    approved: State<'_, ApprovedPaths>,
) -> Result<Option<String>, String> {
    app.dialog()
        .file()
        .set_title("选择项目保存位置")
        .blocking_pick_folder()
        .map(|selected| {
            selected
                .into_path()
                .map_err(|_| "The selected folder is unavailable".to_string())
                .and_then(|path| approved.approve_parent(path))
        })
        .transpose()
}

#[tauri::command]
async fn select_project_folder(
    app: tauri::AppHandle,
    approved: State<'_, ApprovedPaths>,
) -> Result<Option<String>, String> {
    app.dialog()
        .file()
        .set_title("选择 SCOPE 项目文件夹")
        .blocking_pick_folder()
        .map(|selected| {
            selected
                .into_path()
                .map_err(|_| "The selected folder is unavailable".to_string())
                .and_then(|path| approved.approve_project(path))
        })
        .transpose()
}

#[tauri::command]
async fn select_txt_files(
    app: tauri::AppHandle,
    approved: State<'_, ApprovedPaths>,
) -> Result<Option<Vec<String>>, String> {
    app.dialog()
        .file()
        .set_title("选择 TXT 语料")
        .add_filter("TXT 文本", &["txt"])
        .blocking_pick_files()
        .map(|selected| {
            selected
                .into_iter()
                .map(|file_path| {
                    file_path
                        .into_path()
                        .map_err(|_| "A selected file is unavailable".to_string())
                        .and_then(|path| approved.approve_source(path))
                })
                .collect()
        })
        .transpose()
}

#[cfg(feature = "e2e")]
#[tauri::command]
fn e2e_paths(approved: State<'_, ApprovedPaths>) -> Result<Value, String> {
    let parent_path = std::env::var("SCOPE_E2E_PARENT")
        .map_err(|_| "SCOPE_E2E_PARENT is required for the E2E test build".to_string())?;
    let encoded_file_paths = std::env::var_os("SCOPE_E2E_FILES")
        .ok_or_else(|| "SCOPE_E2E_FILES is required for the E2E test build".to_string())?;
    let parent_path = approved.approve_parent(parent_path)?;
    let file_paths: Vec<String> = std::env::split_paths(&encoded_file_paths)
        .map(|path| approved.approve_source(path))
        .collect::<Result<_, _>>()?;
    Ok(json!({"parent_path": parent_path, "file_paths": file_paths}))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(feature = "e2e")]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());

    let builder = builder.plugin(tauri_plugin_dialog::init());

    #[cfg(feature = "e2e")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        engine_describe,
        diagnostic_run,
        diagnostic_cancel,
        diagnostic_crash,
        project_create,
        project_open,
        corpus_import_txt,
        document_get,
        select_project_parent,
        select_project_folder,
        select_txt_files,
        e2e_paths
    ]);

    #[cfg(not(feature = "e2e"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        engine_describe,
        diagnostic_run,
        diagnostic_cancel,
        diagnostic_crash,
        project_create,
        project_open,
        corpus_import_txt,
        document_get,
        select_project_parent,
        select_project_folder,
        select_txt_files
    ]);

    builder
        .manage(EngineSupervisor::new(CommandSpec::for_current_build()))
        .manage(ApprovedPaths::default())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod approved_path_tests {
    use super::ApprovedPaths;
    use std::{fs, time::SystemTime};

    #[test]
    fn requires_each_exact_user_approved_path() {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system clock should be after Unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("scope-path-test-{unique}"));
        let project = root.join("项目");
        let source = root.join("语料.txt");
        fs::create_dir_all(&project).expect("test project directory should be created");
        fs::write(&source, "语料").expect("test source should be created");
        let approved = ApprovedPaths::default();

        let approved_parent = approved
            .approve_parent(&root)
            .expect("parent approval should succeed");
        assert!(approved.require_parent(&root).is_ok());
        assert!(approved.require_parent(approved_parent).is_ok());
        assert!(approved.require_project(&project).is_err());

        approved
            .approve_project(&project)
            .expect("project approval should succeed");
        approved
            .approve_source(&source)
            .expect("source approval should succeed");
        assert!(approved.require_project(&project).is_ok());
        assert!(approved.require_source(&source).is_ok());
        assert!(approved
            .require_source(project.join("not-approved.txt"))
            .is_err());

        fs::remove_dir_all(&root).expect("test directory should be removed");
    }
}

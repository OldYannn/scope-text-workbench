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
    exports: Mutex<HashSet<PathBuf>>,
}

impl ApprovedPaths {
    #[cfg(windows)]
    fn comparison_path(path: PathBuf) -> PathBuf {
        let display = path.to_string_lossy();
        if let Some(rest) = display.strip_prefix(r"\\?\UNC\") {
            PathBuf::from(format!(r"\\{rest}"))
        } else if let Some(rest) = display.strip_prefix(r"\\?\") {
            PathBuf::from(rest)
        } else {
            path
        }
    }

    #[cfg(not(windows))]
    fn comparison_path(path: PathBuf) -> PathBuf {
        path
    }

    fn canonical(path: impl AsRef<Path>) -> Result<PathBuf, String> {
        std::fs::canonicalize(path)
            .map(Self::comparison_path)
            .map_err(|_| "The selected path is no longer available".into())
    }

    fn insert(set: &Mutex<HashSet<PathBuf>>, path: impl AsRef<Path>) -> Result<String, String> {
        let canonical = Self::canonical(path)?;
        set.lock()
            .map_err(|_| "Path approval state is unavailable".to_string())?
            .insert(canonical.clone());
        Ok(canonical.to_string_lossy().into_owned())
    }

    fn require(set: &Mutex<HashSet<PathBuf>>, path: impl AsRef<Path>) -> Result<(), String> {
        let supplied = Self::comparison_path(path.as_ref().to_path_buf());
        let approvals = set
            .lock()
            .map_err(|_| "Path approval state is unavailable".to_string())?;
        if approvals.contains(&supplied) {
            Ok(())
        } else {
            drop(approvals);
            let canonical = Self::canonical(&supplied)?;
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
        let supplied = Self::comparison_path(path.as_ref().to_path_buf());
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

    fn approve_export(&self, path: impl AsRef<Path>) -> Result<String, String> {
        let path = Self::comparison_path(path.as_ref().to_path_buf());
        self.exports
            .lock()
            .map_err(|_| "Path approval state is unavailable".to_string())?
            .insert(path.clone());
        Ok(path.to_string_lossy().into_owned())
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

    fn require_export(&self, path: impl AsRef<Path>) -> Result<(), String> {
        let supplied = Self::comparison_path(path.as_ref().to_path_buf());
        if self
            .exports
            .lock()
            .map_err(|_| "Path approval state is unavailable".to_string())?
            .contains(&supplied)
        {
            Ok(())
        } else {
            Err("The export path was not approved by the system file picker".into())
        }
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
async fn request_cancel(
    supervisor: State<'_, EngineSupervisor>,
    request_id: String,
    target_request_id: String,
) -> Result<Value, String> {
    diagnostic_cancel(supervisor, request_id, target_request_id).await
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

async fn text_clean(
    supervisor: State<'_, EngineSupervisor>,
    approved: State<'_, ApprovedPaths>,
    request_id: String,
    project_path: String,
    document_id: String,
    rules: Value,
    method: &'static str,
) -> Result<Value, String> {
    approved.require_project(&project_path)?;
    dispatch(&supervisor, None, json!({
        "protocol_version": "0.1", "request_id": request_id,
        "method": method, "params": {"project_path": project_path, "document_id": document_id, "rules": rules}
    })).await
}

#[tauri::command]
async fn text_clean_preview(
    supervisor: State<'_, EngineSupervisor>,
    approved: State<'_, ApprovedPaths>,
    request_id: String,
    project_path: String,
    document_id: String,
    rules: Value,
) -> Result<Value, String> {
    text_clean(
        supervisor,
        approved,
        request_id,
        project_path,
        document_id,
        rules,
        "text.clean.preview",
    )
    .await
}

#[tauri::command]
async fn text_clean_execute(
    supervisor: State<'_, EngineSupervisor>,
    approved: State<'_, ApprovedPaths>,
    request_id: String,
    project_path: String,
    document_id: String,
    rules: Value,
) -> Result<Value, String> {
    text_clean(
        supervisor,
        approved,
        request_id,
        project_path,
        document_id,
        rules,
        "text.clean.execute",
    )
    .await
}

#[tauri::command]
async fn text_clean_batch(
    app: tauri::AppHandle,
    supervisor: State<'_, EngineSupervisor>,
    approved: State<'_, ApprovedPaths>,
    request_id: String,
    project_path: String,
    rules: Value,
    reprocess_all: bool,
) -> Result<Value, String> {
    approved.require_project(&project_path)?;
    dispatch(
        &supervisor,
        Some(app),
        json!({
            "protocol_version":"0.1","request_id":request_id,"method":"text.clean.batch",
            "params":{"project_path":project_path,"rules":rules,"reprocess_all":reprocess_all}
        }),
    )
    .await
}

async fn text_tokenize(
    supervisor: State<'_, EngineSupervisor>,
    approved: State<'_, ApprovedPaths>,
    request_id: String,
    project_path: String,
    document_id: String,
    config: Value,
    method: &'static str,
) -> Result<Value, String> {
    approved.require_project(&project_path)?;
    dispatch(&supervisor, None, json!({"protocol_version":"0.1","request_id":request_id,"method":method,"params":{"project_path":project_path,"document_id":document_id,"config":config}})).await
}

#[tauri::command]
async fn text_tokenize_preview(
    supervisor: State<'_, EngineSupervisor>,
    approved: State<'_, ApprovedPaths>,
    request_id: String,
    project_path: String,
    document_id: String,
    config: Value,
) -> Result<Value, String> {
    text_tokenize(
        supervisor,
        approved,
        request_id,
        project_path,
        document_id,
        config,
        "text.tokenize.preview",
    )
    .await
}

#[tauri::command]
async fn text_tokenize_execute(
    supervisor: State<'_, EngineSupervisor>,
    approved: State<'_, ApprovedPaths>,
    request_id: String,
    project_path: String,
    document_id: String,
    config: Value,
) -> Result<Value, String> {
    text_tokenize(
        supervisor,
        approved,
        request_id,
        project_path,
        document_id,
        config,
        "text.tokenize.execute",
    )
    .await
}

#[tauri::command]
async fn text_tokenize_batch(
    app: tauri::AppHandle,
    supervisor: State<'_, EngineSupervisor>,
    approved: State<'_, ApprovedPaths>,
    request_id: String,
    project_path: String,
    config: Value,
    reprocess_all: bool,
) -> Result<Value, String> {
    approved.require_project(&project_path)?;
    dispatch(
        &supervisor,
        Some(app),
        json!({
            "protocol_version":"0.1","request_id":request_id,"method":"text.tokenize.batch",
            "params":{"project_path":project_path,"config":config,"reprocess_all":reprocess_all}
        }),
    )
    .await
}

#[tauri::command]
async fn tokenization_dictionary_import(
    supervisor: State<'_, EngineSupervisor>,
    approved: State<'_, ApprovedPaths>,
    request_id: String,
    project_path: String,
    file_path: String,
) -> Result<Value, String> {
    approved.require_project(&project_path)?;
    approved.require_source(&file_path)?;
    dispatch(&supervisor, None, json!({"protocol_version":"0.1","request_id":request_id,"method":"tokenization.dictionary.import","params":{"project_path":project_path,"file_path":file_path}})).await
}

#[tauri::command]
async fn frequency_analyze(
    supervisor: State<'_, EngineSupervisor>,
    approved: State<'_, ApprovedPaths>,
    request_id: String,
    project_path: String,
    profile_config: Option<Value>,
) -> Result<Value, String> {
    approved.require_project(&project_path)?;
    dispatch(&supervisor, None, json!({"protocol_version":"0.1","request_id":request_id,"method":"frequency.analyze","params":{"project_path":project_path,"profile_config":profile_config}})).await
}

#[tauri::command]
async fn stopword_profiles(
    supervisor: State<'_, EngineSupervisor>,
    request_id: String,
) -> Result<Value, String> {
    dispatch(&supervisor, None, json!({"protocol_version":"0.1","request_id":request_id,"method":"stopwords.profiles","params":{}})).await
}

#[tauri::command]
async fn stopword_get(
    supervisor: State<'_, EngineSupervisor>,
    approved: State<'_, ApprovedPaths>,
    request_id: String,
    project_path: String,
) -> Result<Value, String> {
    approved.require_project(&project_path)?;
    dispatch(&supervisor, None, json!({"protocol_version":"0.1","request_id":request_id,"method":"stopwords.get","params":{"project_path":project_path}})).await
}

#[tauri::command]
async fn stopword_resolve(
    supervisor: State<'_, EngineSupervisor>,
    approved: State<'_, ApprovedPaths>,
    request_id: String,
    project_path: String,
    base_profile_id: String,
    custom_additions: Vec<String>,
    custom_exclusions: Vec<String>,
) -> Result<Value, String> {
    approved.require_project(&project_path)?;
    dispatch(&supervisor, None, json!({"protocol_version":"0.1","request_id":request_id,"method":"stopwords.resolve","params":{"project_path":project_path,"base_profile_id":base_profile_id,"custom_additions":custom_additions,"custom_exclusions":custom_exclusions}})).await
}

#[tauri::command]
async fn stopword_import(
    supervisor: State<'_, EngineSupervisor>,
    approved: State<'_, ApprovedPaths>,
    request_id: String,
    project_path: String,
    file_path: String,
) -> Result<Value, String> {
    approved.require_project(&project_path)?;
    approved.require_source(&file_path)?;
    dispatch(&supervisor, None, json!({"protocol_version":"0.1","request_id":request_id,"method":"stopwords.import","params":{"project_path":project_path,"file_path":file_path}})).await
}

#[tauri::command]
async fn frequency_export(
    supervisor: State<'_, EngineSupervisor>,
    approved: State<'_, ApprovedPaths>,
    request_id: String,
    project_path: String,
    destination: String,
    format: String,
) -> Result<Value, String> {
    approved.require_project(&project_path)?;
    approved.require_export(&destination)?;
    dispatch(&supervisor, None, json!({"protocol_version":"0.1","request_id":request_id,"method":"frequency.export","params":{"project_path":project_path,"destination":destination,"format":format}})).await
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
        .set_title("选择 SCOPE 项目文件夹（请选择包含 project.json 的项目根目录）")
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
async fn select_project_json(
    app: tauri::AppHandle,
    approved: State<'_, ApprovedPaths>,
) -> Result<Option<String>, String> {
    app.dialog()
        .file()
        .set_title("选择 SCOPE 项目的 project.json")
        .add_filter("SCOPE 项目配置", &["json"])
        .blocking_pick_file()
        .map(|selected| {
            selected
                .into_path()
                .map_err(|_| "The selected file is unavailable".to_string())
                .and_then(|path| {
                    if path.file_name().and_then(|name| name.to_str()) != Some("project.json") {
                        return Err("请选择 SCOPE 项目根目录中的 project.json。".to_string());
                    }
                    approved.approve_project(
                        path.parent()
                            .ok_or_else(|| "无法确定项目根目录".to_string())?,
                    )
                })
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

#[tauri::command]
async fn select_user_dictionary(
    app: tauri::AppHandle,
    approved: State<'_, ApprovedPaths>,
) -> Result<Option<String>, String> {
    app.dialog()
        .file()
        .set_title("选择中文用户词典（UTF-8 TXT）")
        .add_filter("TXT 词典", &["txt"])
        .blocking_pick_file()
        .map(|selected| {
            selected
                .into_path()
                .map_err(|_| "A selected file is unavailable".to_string())
                .and_then(|path| approved.approve_source(path))
        })
        .transpose()
}

#[tauri::command]
async fn select_stopword_file(
    app: tauri::AppHandle,
    approved: State<'_, ApprovedPaths>,
) -> Result<Option<String>, String> {
    app.dialog()
        .file()
        .set_title("选择 UTF-8 停用词 TXT")
        .add_filter("TXT 词表", &["txt"])
        .blocking_pick_file()
        .map(|selected| {
            selected
                .into_path()
                .map_err(|_| "The selected file is unavailable".to_string())
                .and_then(|path| approved.approve_source(path))
        })
        .transpose()
}

#[tauri::command]
async fn select_frequency_export(
    app: tauri::AppHandle,
    approved: State<'_, ApprovedPaths>,
    format: String,
) -> Result<Option<String>, String> {
    let (title, extension) = if format == "xlsx" {
        ("导出 XLSX 词频结果", "xlsx")
    } else {
        ("导出 CSV 词频结果", "csv")
    };
    #[cfg(feature = "e2e")]
    if let Ok(directory) = std::env::var("SCOPE_E2E_EXPORT_DIR") {
        let path = std::path::PathBuf::from(directory).join(format!("词频结果.{extension}"));
        return approved.approve_export(path).map(Some);
    }
    app.dialog()
        .file()
        .set_title(title)
        .add_filter(extension, &[extension])
        .blocking_save_file()
        .map(|selected| {
            selected
                .into_path()
                .map_err(|_| "The selected path is unavailable".to_string())
                .and_then(|path| approved.approve_export(path))
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
        request_cancel,
        diagnostic_crash,
        project_create,
        project_open,
        corpus_import_txt,
        document_get,
        text_clean_preview,
        text_clean_execute,
        text_clean_batch,
        text_tokenize_preview,
        text_tokenize_execute,
        text_tokenize_batch,
        tokenization_dictionary_import,
        frequency_analyze,
        stopword_profiles,
        stopword_get,
        stopword_resolve,
        stopword_import,
        frequency_export,
        select_frequency_export,
        select_project_parent,
        select_project_folder,
        select_project_json,
        select_txt_files,
        select_user_dictionary,
        select_stopword_file,
        e2e_paths
    ]);

    #[cfg(not(feature = "e2e"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        engine_describe,
        diagnostic_run,
        diagnostic_cancel,
        request_cancel,
        diagnostic_crash,
        project_create,
        project_open,
        corpus_import_txt,
        document_get,
        text_clean_preview,
        text_clean_execute,
        text_clean_batch,
        text_tokenize_preview,
        text_tokenize_execute,
        text_tokenize_batch,
        tokenization_dictionary_import,
        frequency_analyze,
        stopword_profiles,
        stopword_get,
        stopword_resolve,
        stopword_import,
        frequency_export,
        select_frequency_export,
        select_project_parent,
        select_project_folder,
        select_project_json,
        select_txt_files,
        select_user_dictionary,
        select_stopword_file
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

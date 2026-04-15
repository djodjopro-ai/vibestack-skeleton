use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::Manager;

// --- Filesystem types ---

#[derive(Serialize)]
struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
}

#[derive(Serialize, Deserialize)]
struct AppConfig {
    working_directory: Option<String>,
}

// --- Helpers ---

fn get_config_path(app: &tauri::AppHandle) -> PathBuf {
    let app_data = app.path().app_data_dir().expect("failed to get app data dir");
    fs::create_dir_all(&app_data).ok();
    app_data.join("config.json")
}

fn validate_path(working_dir: &str, requested_path: &str) -> Result<PathBuf, String> {
    let base = Path::new(working_dir).canonicalize().map_err(|e| e.to_string())?;
    let full = base.join(requested_path).canonicalize().map_err(|e| format!("Path not found: {}", e))?;
    if !full.starts_with(&base) {
        return Err("Access denied: path is outside working directory".to_string());
    }
    Ok(full)
}

fn validate_parent_path(working_dir: &str, requested_path: &str) -> Result<PathBuf, String> {
    let base = Path::new(working_dir).canonicalize().map_err(|e| e.to_string())?;
    let full = base.join(requested_path);
    if let Some(parent) = full.parent() {
        let canonical_parent = parent.canonicalize().map_err(|e| format!("Parent dir not found: {}", e))?;
        if !canonical_parent.starts_with(&base) {
            return Err("Access denied: path is outside working directory".to_string());
        }
    }
    Ok(full)
}

// --- Tauri commands ---

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn get_working_directory(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let config_path = get_config_path(&app);
    if !config_path.exists() {
        return Ok(None);
    }
    let data = fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
    let config: AppConfig = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    Ok(config.working_directory)
}

#[tauri::command]
fn set_working_directory(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let config_path = get_config_path(&app);
    let config = AppConfig { working_directory: Some(path) };
    let data = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&config_path, data).map_err(|e| e.to_string())
}

#[tauri::command]
fn fs_list_dir(app: tauri::AppHandle, path: String) -> Result<Vec<FileEntry>, String> {
    let working_dir = get_working_directory(app.clone())?.ok_or("No working directory set")?;
    let full_path = if path.is_empty() {
        Path::new(&working_dir).to_path_buf()
    } else {
        validate_path(&working_dir, &path)?
    };

    let entries = fs::read_dir(&full_path).map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        result.push(FileEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: entry.path().strip_prefix(&working_dir).unwrap_or(&entry.path()).to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
            size: metadata.len(),
        });
    }
    Ok(result)
}

#[tauri::command]
fn fs_read_text_file(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let working_dir = get_working_directory(app)?.ok_or("No working directory set")?;
    let full_path = validate_path(&working_dir, &path)?;
    fs::read_to_string(&full_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn fs_write_text_file(app: tauri::AppHandle, path: String, content: String) -> Result<(), String> {
    let working_dir = get_working_directory(app)?.ok_or("No working directory set")?;
    let full_path = validate_parent_path(&working_dir, &path)?;
    fs::write(&full_path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn fs_move_file(app: tauri::AppHandle, from: String, to: String) -> Result<(), String> {
    let working_dir = get_working_directory(app)?.ok_or("No working directory set")?;
    let from_path = validate_path(&working_dir, &from)?;
    let to_path = validate_parent_path(&working_dir, &to)?;
    fs::rename(&from_path, &to_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn fs_copy_file(app: tauri::AppHandle, from: String, to: String) -> Result<(), String> {
    let working_dir = get_working_directory(app)?.ok_or("No working directory set")?;
    let from_path = validate_path(&working_dir, &from)?;
    let to_path = validate_parent_path(&working_dir, &to)?;
    fs::copy(&from_path, &to_path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn fs_delete_file(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let working_dir = get_working_directory(app)?.ok_or("No working directory set")?;
    let full_path = validate_path(&working_dir, &path)?;
    if full_path.is_dir() {
        fs::remove_dir_all(&full_path).map_err(|e| e.to_string())
    } else {
        fs::remove_file(&full_path).map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn fs_create_dir(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let working_dir = get_working_directory(app)?.ok_or("No working directory set")?;
    let full_path = validate_parent_path(&working_dir, &path)?;
    fs::create_dir_all(&full_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn fs_read_binary_file(app: tauri::AppHandle, path: String) -> Result<String, String> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    let working_dir = get_working_directory(app)?.ok_or("No working directory set")?;
    let full_path = validate_path(&working_dir, &path)?;
    let bytes = fs::read(&full_path).map_err(|e| e.to_string())?;
    Ok(STANDARD.encode(&bytes))
}

// --- App entry ---

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            get_working_directory,
            set_working_directory,
            fs_list_dir,
            fs_read_text_file,
            fs_write_text_file,
            fs_move_file,
            fs_copy_file,
            fs_delete_file,
            fs_create_dir,
            fs_read_binary_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

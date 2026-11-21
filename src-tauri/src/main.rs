// 在 Windows 上正式版不弹黑色的命令行窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    philidor_lib::run()
}

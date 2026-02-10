// Sambee Companion — entry point
//
// Delegates to the library's run() function.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    sambee_companion_lib::run();
}

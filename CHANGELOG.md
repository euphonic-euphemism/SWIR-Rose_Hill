# Changelog

All notable changes to this project will be documented in this file.

## [1.0.15] - 2026-01-24

(Re-release to include code artifacts missed in 1.0.14 build)

### 🚀 New Features

*   **QuickSIN Integration**
    *   Added a **QuickSIN Score (dB)** input field to the Patient Information area.
    *   Entering a score automatically adjusts the SNR Slider (`Score + 10 dB`).
    *   Includes a safety cap at 25 dB SNR.

*   **Hearing Aid Model Tracking**
    *   Added a text input for **Hearing Aid Model** for Form A and Form B.
    *   This data is now included in the exported text files and the generated PDF report.

*   **Automatic Stopping Rule**
    *   The test now automatically stops if the patient scores **0% correct on two consecutive blocks** (Form A or B only).
    *   Remaining blocks are automatically marked as incorrect, allowing you to skip unnecessary testing frustration.

*   **Practice Mode Overhaul**
    *   Practice Mode now uses the **Standard Form View** for a consistent experience.
    *   Correctly enforces block structure: **Block 1 (3 sentences)** and **Block 2 (5 sentences)**.
    *   Fixed an issue where duplicate sentences were appearing or playing all at once.

### 🛠 Improvements & Changes

*   **Extended SNR Range**: The Signal-to-Noise Ratio slider now ranges from **0 dB to 25 dB** (previously -10 to +20).
*   **Net Benefit Display**: Net Benefit scores are now displayed as **absolute values** (e.g., `5.0%`) without positive/negative signs in the app, exports, and PDFs.
*   **Form Selection**:
    *   **Practice Mode** is now the **default** selection when the app opens or a new test is started.
    *   Reordered selection buttons: **Practice** (Left) — **Form A** — **Form B**.
    *   Restored original button color scheme (Practice=Yellow/Gray, Forms=Blue/Gray).

### 🐛 Bug Fixes

*   Fixed an issue where the block counter display was hardcoded to `/5` (now correctly shows `/2` for Practice).
*   Removed duplicate sentence entries from the database.

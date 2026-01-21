SWIR Rose Hill - Speech Audiometry Scoring System

This application is a specialized speech audiometry scoring tool designed to administer and score the SWIR (Speech Words in Reverberation) test. It replaces legacy manual scoring methods with a modern, cross-platform Electron/React interface.

The system allows audiologists to play pre-recorded sentence blocks, control signal-to-noise ratios (SNR), and digitally score patient responses in real-time.
Features
🎧 Audio Playback & Control

    Form Management: Seamlessly switch between Form A and Form B sentence lists.

    Block Structure: Plays sentences in standard blocks of varying sizes (3, 4, 5, 6, 7 sentences).

    Channel Routing: Configurable stereo output allows for split routing (Speech Left/Noise Right or Speech Right/Noise Left).

    Calibration: Built-in 1kHz calibration tone generator for setting precise audiometer levels.

📉 Advanced Noise Control

    Speech-Shaped Noise: Option to toggle continuous background noise during testing.

    SNR Adjustment: Real-time slider to adjust Signal-to-Noise Ratio from -10 dB to +20 dB.

    Stereo Separation: Independent panning ensures speech and noise are routed to opposite ears as required by the testing protocol.

📝 Scoring & Analytics

    Digital Scoring: Simple "Correct/Incorrect" interface for each target word.

    Live Visualization: Real-time bar charts compare patient performance across different block sizes.

    Data Export: Exports session results to a detailed text file, including timestamp, individual sentence scores, and percentage summaries.

    Resume Capability: Scores are preserved in the application state even when switching between forms.

Installation

This project is built with Electron and React.

    Clone the repository
    Bash

    git clone https://github.com/euphonic-euphemism/SWIR-Rose_Hill.git
    cd SWIR-Rose_Hill

    Install dependencies
    Bash

    npm install

    Run in Development Mode This will start the React dev server and launch the Electron wrapper:
    Bash

    npm run dev

    Build for Production To create a standalone executable (Windows/Linux/Mac):
    Bash

    npm run package

Usage Guide

    Calibration: Before starting a test, click "🔊 Both Channels" (or individual channels) to play the calibration tone and adjust your audiometer to VU 0.

    Select Form: Choose Form A or Form B at the top of the interface.

    Configure Output: Select the desired output routing (e.g., "Speech Left / Noise Right").

    Playback: Click "▶ Play Block" to present the sentences. The audio plays automatically with a 3-second inter-stimulus interval.

    Scoring: After the block finishes, the scoring interface appears. Mark each target word as Correct (✓) or Incorrect (✗) based on the patient's response.

    Export: At the end of the session, click "Export Results" to save a permanent record.

Project Structure

    src/App.js: Main application logic, state management, and audio handling.

    electron/main.js: Electron main process configuration.

    audio_output/: Directory containing the .wav sentence recordings and calibration tones.

    sentences.json: Data file containing the transcripts and target words for all forms.

License

MIT License

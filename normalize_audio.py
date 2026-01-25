import os
import glob
import numpy as np
from scipy.io import wavfile

# --- CONFIGURATION ---
# The root folder where your project audio lives
BASE_PATH = "/home/marks/Development/swir_project/audio_output"

# Where the "Ruler" files live (Shared Assets)
CALIBRATION_FILE = os.path.join(BASE_PATH, "calibration_1khz_neg20db.wav")
NOISE_FILE = os.path.join(BASE_PATH, "speech_shaped_noise.wav")
BABBLE_FILE = os.path.join(BASE_PATH, "babble_noise.wav")

# The specific subfolders where your sentences are hiding
TARGET_FOLDERS = [
    os.path.join(BASE_PATH, "Form A/wav"),
    os.path.join(BASE_PATH, "Form B/wav"),
    os.path.join(BASE_PATH, "Form C/wav"),
    os.path.join(BASE_PATH, "Form P/wav")
]

def measure_rms(audio_data):
    """Calculate Root Mean Square (average energy) of a signal"""
    data = audio_data.astype(np.float64)
    return np.sqrt(np.mean(data**2))

def normalize_structured_assets():
    # 1. Measure the "Anchor" (Calibration Tone)
    if not os.path.exists(CALIBRATION_FILE):
        print(f"CRITICAL ERROR: Calibration file not found at: {CALIBRATION_FILE}")
        print("Please ensure it is in the root 'audio_output' folder.")
        return

    sr, cal_audio = wavfile.read(CALIBRATION_FILE)
    target_rms = measure_rms(cal_audio)

    print(f"Target RMS (Reference): {target_rms:.4f}")

    # 2. Build the Master List of files to process
    files_to_process = []

    # A. Add the Noise File (if it exists)
    if os.path.exists(NOISE_FILE):
        files_to_process.append(NOISE_FILE)
    else:
        print(f"Warning: Noise file not found at {NOISE_FILE}")

    # A.2 Add the Babble File (if it exists)
    if os.path.exists(BABBLE_FILE):
        files_to_process.append(BABBLE_FILE)
    else:
        print(f"Warning: Babble file not found at {BABBLE_FILE}")

    # B. Add all sentences from Form A and Form B
    for folder in TARGET_FOLDERS:
        if not os.path.exists(folder):
            print(f"Warning: Folder not found: {folder}")
            continue

        # Find all .wav files in this folder
        search_pattern = os.path.join(folder, "swir_*.wav")
        found_files = glob.glob(search_pattern)
        print(f"Found {len(found_files)} sentences in: {folder}")
        files_to_process.extend(found_files)

    print(f"Starting normalization for {len(files_to_process)} total files...")

    # 3. Process them all
    for wf in files_to_process:
        try:
            sr, audio = wavfile.read(wf)

            current_rms = measure_rms(audio)
            if current_rms == 0: continue

            # Calculate Gain
            gain = target_rms / current_rms

            # Apply Gain
            new_audio = audio.astype(np.float64) * gain

            # Clip protection
            if np.max(np.abs(new_audio)) > 32767:
                new_audio = np.clip(new_audio, -32767, 32767)

            # Save (Overwrite)
            wavfile.write(wf, sr, new_audio.astype(np.int16))

            # Cleaner output: print file name only
            name = os.path.basename(wf)
            # print(f" -> Normalized {name}")

        except Exception as e:
            print(f"Error processing {wf}: {e}")

    print("Success! All Form A, Form B, and Noise files are calibrated.")

if __name__ == "__main__":
    normalize_structured_assets()

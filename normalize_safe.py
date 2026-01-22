import os
import glob
import numpy as np
from scipy.io import wavfile

# --- CONFIGURATION ---
BASE_PATH = "/home/marks/Development/swir_project/audio_output"
CALIBRATION_FILE = os.path.join(BASE_PATH, "calibration_1khz_neg20db.wav")
# We scan Form A, Form B, and the root folder (for babble)
TARGET_FOLDERS = [
    BASE_PATH,
    os.path.join(BASE_PATH, "Form A/wav"),
    os.path.join(BASE_PATH, "Form B/wav")
]

def measure_rms(audio_data):
    data = audio_data.astype(np.float64)
    return np.sqrt(np.mean(data**2))

def normalize_safe():
    if not os.path.exists(CALIBRATION_FILE):
        print("Error: Calibration file missing.")
        return

    sr, cal_audio = wavfile.read(CALIBRATION_FILE)
    target_rms = measure_rms(cal_audio)
    print(f"Target RMS (from Calibration): {target_rms:.2f}")

    # Gather files (Sentences + Babble)
    files = []
    for folder in TARGET_FOLDERS:
        # Grab wavs, but exclude the calibration file itself
        found = glob.glob(os.path.join(folder, "*.wav"))
        files.extend([f for f in found if "calibration" not in f])

    print(f"Processing {len(files)} files...")

    for wf in files:
        try:
            sr, audio = wavfile.read(wf)
            if len(audio) == 0: continue

            current_rms = measure_rms(audio)
            if current_rms == 0: continue

            # 1. Calculate ideal gain to match RMS
            gain = target_rms / current_rms

            # 2. Test the gain
            audio_float = audio.astype(np.float64)
            proposed_audio = audio_float * gain

            # 3. SAFETY CHECK: Check for clipping
            max_val = np.max(np.abs(proposed_audio))
            MAX_ALLOWED = 32700  # Just under the 16-bit limit (32767)

            if max_val > MAX_ALLOWED:
                # If we are about to clip, calculate a "Safety Gain"
                # This reduces volume just enough to save the peaks
                safety_ratio = MAX_ALLOWED / max_val
                gain = gain * safety_ratio
                print(f" -> Protected {os.path.basename(wf)} from clipping (Reduced by {safety_ratio:.2f}x)")

            # 4. Apply Final Gain
            final_audio = audio_float * gain
            wavfile.write(wf, sr, final_audio.astype(np.int16))

        except Exception as e:
            print(f"Error on {wf}: {e}")

    print("Success! All files normalized (with peak protection).")

if __name__ == "__main__":
    normalize_safe()

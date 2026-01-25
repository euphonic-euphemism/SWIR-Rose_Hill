import os
import glob
import numpy as np
from scipy.io import wavfile
import math

# --- CONFIGURATION ---
BASE_PATH = "/home/marks/Development/swir_project/audio_output"

# Assets
CALIBRATION_FILE = os.path.join(BASE_PATH, "calibration_1khz_neg20db.wav")
BABBLE_FILE = os.path.join(BASE_PATH, "babble_noise.wav")
SPEECH_NOISE_FILE = os.path.join(BASE_PATH, "speech_shaped_noise.wav")

# Sentences
TARGET_FOLDERS = [
    os.path.join(BASE_PATH, "Form A/wav"),
    os.path.join(BASE_PATH, "Form B/wav"),
    os.path.join(BASE_PATH, "Form C/wav"),
    os.path.join(BASE_PATH, "Form P/wav") # Added Form C and P based on list_dir output
]

def measure_rms(audio_data):
    """Calculate Root Mean Square (average energy) of a signal"""
    data = audio_data.astype(np.float64)
    # Avoid divide by zero if empty
    if len(data) == 0: return 0
    return np.sqrt(np.mean(data**2))

def to_db(rms):
    if rms == 0: return -float('inf')
    # Assuming 16-bit audio (32768 max), but the relative dB matters most.
    # We'll report dB relative to full scale (dBFS) roughly.
    return 20 * math.log10(rms / 32768.0)

def verify_levels():
    print("--- Audio Intensity Verification ---")
    
    # 1. Reference (Calibration Tone)
    if not os.path.exists(CALIBRATION_FILE):
        print(f"CRITICAL: Calibration file missing: {CALIBRATION_FILE}")
        return
        
    sr, cal_audio = wavfile.read(CALIBRATION_FILE)
    ref_rms = measure_rms(cal_audio)
    ref_db = to_db(ref_rms)
    
    print(f"\nREFERENCE (Calibration Tone):")
    print(f"  RMS: {ref_rms:.4f}")
    print(f"  dB:  {ref_db:.2f}")
    
    # 2. Noise Files
    print(f"\nNOISE FILES:")
    for name, path in [("Babble Noise", BABBLE_FILE), ("Speech Noise", SPEECH_NOISE_FILE)]:
        if os.path.exists(path):
            sr, audio = wavfile.read(path)
            rms = measure_rms(audio)
            db = to_db(rms)
            diff = db - ref_db
            status = "MATCH" if abs(diff) < 0.1 else "MISMATCH"
            print(f"  {name}: {db:.2f} dB (Diff: {diff:+.2f} dB) -> {status}")
        else:
            print(f"  {name}: FILE NOT FOUND")

    # 3. Sentences
    print(f"\nSENTENCES:")
    all_sentence_rms = []
    
    sentence_files = []
    for folder in TARGET_FOLDERS:
        if os.path.exists(folder):
            sentence_files.extend(glob.glob(os.path.join(folder, "swir_*.wav")))
            
    if not sentence_files:
        print("  No sentence files found.")
        return

    print(f"  Analyzing {len(sentence_files)} files...")
    
    mismatches = 0
    for f in sentence_files:
        try:
            sr, audio = wavfile.read(f)
            rms = measure_rms(audio)
            db = to_db(rms)
            diff = db - ref_db
            
            all_sentence_rms.append(rms)
            
            if abs(diff) > 0.1: # 0.1 dB tolerance
                mismatches += 1
                # print(f"    MISMATCH: {os.path.basename(f)} ({db:.2f} dB, {diff:+.2f})")
                
        except Exception as e:
            print(f"    Error reading {f}: {e}")

    avg_rms = np.mean(all_sentence_rms)
    avg_db = to_db(avg_rms)
    avg_diff = avg_db - ref_db
    
    print(f"  Average Sentence Level: {avg_db:.2f} dB")
    print(f"  Difference from Ref:    {avg_diff:+.2f} dB")
    print(f"  Individual Mismatches:  {mismatches}/{len(sentence_files)}")
    
    if abs(avg_diff) < 0.1 and mismatches == 0:
        print("\nOVERALL STATUS: PASS (All levels match calibration within 0.1 dB)")
    else:
        print("\nOVERALL STATUS: FAIL (Normalization Required)")

if __name__ == "__main__":
    verify_levels()

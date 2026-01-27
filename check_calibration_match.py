
import numpy as np
import scipy.io.wavfile as wav
import os

def calculate_rms_db(filename):
    if not os.path.exists(filename):
        print(f"File not found: {filename}")
        return None

    rate, data = wav.read(filename)
    
    # Handle stereo/mono
    if len(data.shape) > 1:
        data = data[:, 0] # Take first channel if stereo
        
    # Convert to float and normalize to -1.0 to 1.0
    # Assuming 16-bit audio
    if data.dtype == np.int16:
        data = data.astype(np.float64) / 32768.0
    elif data.dtype == np.int32:
        data = data.astype(np.float64) / 2147483648.0
        
    # Calculate RMS
    rms = np.sqrt(np.mean(data**2))
    
    # Convert to dBFS
    if rms > 0:
        db_fs = 20 * np.log10(rms)
    else:
        db_fs = -np.inf
        
    return db_fs

cal_file = "audio_output/calibration_1khz_neg20db.wav"
noise_file = "audio_output/speech_shaped_noise.wav"

print("--- Audio Level Verification ---")

cal_db = calculate_rms_db(cal_file)
if cal_db is not None:
    print(f"Calibration Tone (1kHz): {cal_db:.2f} dBFS")

noise_db = calculate_rms_db(noise_file)
if noise_db is not None:
    print(f"Speech Shaped Noise:     {noise_db:.2f} dBFS")

if cal_db is not None and noise_db is not None:
    diff = abs(cal_db - noise_db)
    print(f"\nDifference: {diff:.2f} dB")
    if diff < 1.0:
        print("RESULT: MATCH (within 1 dB)")
    else:
        print("RESULT: MISMATCH (> 1 dB difference)")

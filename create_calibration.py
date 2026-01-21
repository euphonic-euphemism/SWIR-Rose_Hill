import os
import numpy as np
from scipy.io import wavfile

# --- CONFIGURATION ---
OUTPUT_FOLDER = "audio_output"
OUTPUT_FILE = "calibration_1khz_neg20db.wav"
FREQUENCY = 1000  # 1 kHz standard
DURATION = 60     # Seconds (Make it long enough to give you time to adjust knobs)
SAMPLE_RATE = 44100
DB_LEVEL = -20.0  # The target level in dBFS

def generate_calibration_tone():
    if not os.path.exists(OUTPUT_FOLDER):
        os.makedirs(OUTPUT_FOLDER)

    print(f"Generating {FREQUENCY}Hz tone at {DB_LEVEL} dBFS...")

    # 1. Calculate the Linear Amplitude from dB
    # Formula: Amplitude = 10 ^ (dB / 20)
    # -20 dB -> 0.1
    amplitude = 10 ** (DB_LEVEL / 20)

    # 2. Generate the Time Axis
    t = np.linspace(0, DURATION, int(SAMPLE_RATE * DURATION), endpoint=False)

    # 3. Generate the Sine Wave
    # y = A * sin(2 * pi * f * t)
    audio = amplitude * np.sin(2 * np.pi * FREQUENCY * t)

    # 4. Convert to 16-bit PCM (Standard WAV format)
    # We multiply the -1.0 to 1.0 float data by the max 16-bit integer (32767)
    audio_int16 = (audio * 32767).astype(np.int16)

    # 5. Save the file
    filepath = os.path.join(OUTPUT_FOLDER, OUTPUT_FILE)
    wavfile.write(filepath, SAMPLE_RATE, audio_int16)

    print(f"Success! Saved calibration tone to: {filepath}")

if __name__ == "__main__":
    generate_calibration_tone()

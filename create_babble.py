import os
import glob
import random
import numpy as np
from scipy.io import wavfile

# --- CONFIGURATION ---
# The root folder for your project
BASE_PATH = "/home/marks/Development/swir_project/audio_output"

# Where to find the source sentences (Form A and Form B)
SOURCE_FOLDERS = [
    os.path.join(BASE_PATH, "Form A/wav"),
    os.path.join(BASE_PATH, "Form B/wav")
]

# Output settings
OUTPUT_FILE = os.path.join(BASE_PATH, "babble_noise.wav")
DURATION_SECONDS = 300    # 300 seconds is plenty for a loop
N_VOICES = 4            # 4-talker babble is the clinical standard for "crowd noise"

def create_custom_babble():
    print("--- Generative Babble Creator ---")

    # 1. Gather all source files
    source_files = []
    for folder in SOURCE_FOLDERS:
        files = glob.glob(os.path.join(folder, "swir_*.wav"))
        source_files.extend(files)

    if not source_files:
        print("CRITICAL ERROR: No sentence files found in Form A or Form B folders.")
        return

    print(f"Found {len(source_files)} source sentences to build the crowd.")

    # 2. Load all audio into memory
    loaded_audio_clips = []
    sample_rate = 0 # Will be set by the first file

    for f in source_files:
        try:
            sr, audio = wavfile.read(f)
            sample_rate = sr

            # Convert to Float64 (-1.0 to 1.0) for mixing math
            # If it's 16-bit integer, normalize it.
            if audio.dtype == np.int16:
                audio = audio.astype(np.float64) / 32768.0

            loaded_audio_clips.append(audio)
        except Exception as e:
            print(f"Skipping bad file {f}: {e}")

    if not loaded_audio_clips:
        print("Error: Could not load any audio clips.")
        return

    # 3. Create the empty timeline (The "Room")
    total_samples = sample_rate * DURATION_SECONDS
    final_mix = np.zeros(total_samples, dtype=np.float64)

    print(f"Generating {N_VOICES} unique voice layers...")

    # 4. Layer the voices
    for voice_idx in range(N_VOICES):
        # Create a temporary track for this single voice
        voice_track = np.zeros(total_samples, dtype=np.float64)
        cursor = 0

        # Fill the track until we reach the end
        while cursor < total_samples:
            # Pick a random sentence
            clip = random.choice(loaded_audio_clips)

            # Start slightly random to avoid robotic synchronization
            # (Shift start point by random silence)
            silence_gap = int(random.uniform(0.1, 0.5) * sample_rate)
            cursor += silence_gap

            if cursor >= total_samples:
                break

            # Calculate where this clip fits
            end = cursor + len(clip)

            # Add it to the voice track
            if end > total_samples:
                # Crop if it goes past the end
                usable_len = total_samples - cursor
                voice_track[cursor:] = clip[:usable_len]
                cursor = total_samples # Done
            else:
                voice_track[cursor:end] = clip
                cursor = end

        # Add this voice to the main room mix
        final_mix += voice_track
        print(f" -> Layer {voice_idx + 1} added.")

    # 5. Normalize the Crowd
    # Summing 12 voices makes it HUGE mathematically, so we must shrink it.
    print("Normalizing final mix...")
    max_val = np.max(np.abs(final_mix))
    if max_val > 0:
        # Scale to peak at 90% (-1 dB)
        final_mix = final_mix / max_val * 0.9

    # 6. Save as 16-bit WAV
    output_int16 = (final_mix * 32767).astype(np.int16)
    wavfile.write(OUTPUT_FILE, sample_rate, output_int16)

    print(f"Success! Babble track saved to:\n{OUTPUT_FILE}")

if __name__ == "__main__":
    create_custom_babble()

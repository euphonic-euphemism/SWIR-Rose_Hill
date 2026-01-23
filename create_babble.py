import os
import glob
import random
import numpy as np
from scipy.io import wavfile

# --- CONFIGURATION ---
# The root folder for your project
BASE_PATH = "/home/marks/Development/swir_project/audio_output"

# Where to find the source sentences
# We ONLY use Form C (Neutral Sentences) to avoid "target collision"
SOURCE_FOLDERS = [
    os.path.join(BASE_PATH, "Form C/wav")
]

# Output settings
OUTPUT_FILE = os.path.join(BASE_PATH, "babble_noise.wav")
DURATION_SECONDS = 300   # 300 second loop (5 Minutes)
N_VOICES = 4             # 4-talker babble (Hard Mode / Informational Masking)

def create_custom_babble():
    print("--- Generative Babble Creator ---")

    # 1. Gather all source files
    source_files = []
    for folder in SOURCE_FOLDERS:
        # Recursive glob to find files even if subfolders exist
        files = glob.glob(os.path.join(folder, "swir_*.wav"))
        source_files.extend(files)

    if not source_files:
        print(f"CRITICAL ERROR: No sentence files found in: {SOURCE_FOLDERS}")
        print("Did you run generate.py with DATA_FILE='babble_sentences.json'?")
        return

    print(f"Found {len(source_files)} source sentences to build the crowd.")

    # 2. Load all audio into memory
    loaded_audio_clips = []
    sample_rate = 44100 # Default, will be updated by file read

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

    print(f"Generating {N_VOICES}-talker babble track ({DURATION_SECONDS}s)...")
    print("This may take a moment due to the longer duration.")

    # 4. Layer the voices
    for voice_idx in range(N_VOICES):
        # Create a temporary track for this single voice
        voice_track = np.zeros(total_samples, dtype=np.float64)
        cursor = 0

        # Start the first sentence at a random offset so voices don't start in unison
        start_delay = int(random.uniform(0, 2.0) * sample_rate)
        cursor += start_delay

        # Fill the track until we reach the end
        while cursor < total_samples:
            # Pick a random sentence
            clip = random.choice(loaded_audio_clips)

            # Determine length of this specific clip
            clip_len = len(clip)

            # Calculate placement
            end = cursor + clip_len

            # Add it to the voice track
            if end > total_samples:
                # Crop if it goes past the end
                usable_len = total_samples - cursor
                voice_track[cursor:] = clip[:usable_len]
                cursor = total_samples # Done
            else:
                voice_track[cursor:end] = clip
                # Add a tiny random breath gap (0.1s to 0.4s) between sentences
                gap = int(random.uniform(0.1, 0.4) * sample_rate)
                cursor = end + gap

        # Add this voice to the main room mix
        final_mix += voice_track
        print(f" -> Voice Layer {voice_idx + 1} added.")

    # 5. Normalize the Crowd (Preliminary)
    # This prevents the raw file from being distorted before the final safety pass
    print("Performing preliminary mix normalization...")
    max_val = np.max(np.abs(final_mix))
    if max_val > 0:
        # Scale to peak at 90% (-1 dB)
        final_mix = final_mix / max_val * 0.9

    # 6. Save as 16-bit WAV
    output_int16 = (final_mix * 32767).astype(np.int16)
    wavfile.write(OUTPUT_FILE, sample_rate, output_int16)

    print(f"Success! Babble track saved to:\n{OUTPUT_FILE}")
    print("IMPORTANT: Now run 'python3 normalize_safe.py' to match the calibration level.")

if __name__ == "__main__":
    create_custom_babble()

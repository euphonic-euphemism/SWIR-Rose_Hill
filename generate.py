import json
import os
import subprocess
from gtts import gTTS

# --- CONFIGURATION ---
# UNCOMMENT the file you want to process:

# Option 1: The Main Test Sentences (Lists A & B)
# DATA_FILE = "sentences.json"

# Option 2: The "Dummy" Sentences for the Background Babble (List C)
DATA_FILE = "babble_sentences.json"

OUTPUT_BASE = "audio_output"

def generate_audio():
    # 1. Load the sentence data
    if not os.path.exists(DATA_FILE):
        print(f"Error: Could not find {DATA_FILE}")
        return

    with open(DATA_FILE, 'r') as f:
        data = json.load(f)

    print(f"Loaded {len(data)} sentences from {DATA_FILE}...")

    # 2. Process each sentence
    for item in data:
        s_id = item['id']
        text = item['text']
        form_list = item['list'] # "A", "B", or "C"

        # Create folder structure: audio_output/Form A/wav/
        folder_path = os.path.join(OUTPUT_BASE, f"Form {form_list}", "wav")
        os.makedirs(folder_path, exist_ok=True)

        # Define filenames
        wav_filename = f"swir_{s_id}.wav"
        wav_path = os.path.join(folder_path, wav_filename)

        # Check if already exists (skip to save time/API calls)
        if os.path.exists(wav_path):
            print(f"Skipping {s_id} (Already exists)")
            continue

        print(f"Generating {s_id}: '{text}'...")

        try:
            # A. Generate MP3 with Google TTS
            tts = gTTS(text=text, lang='en', tld='com')
            temp_mp3 = f"temp_{s_id}.mp3"
            tts.save(temp_mp3)

            # B. Convert MP3 to WAV using FFmpeg (No pydub required)
            # Flags: -i (input), -ac 1 (mono), -ar 44100 (44.1kHz), -y (overwrite)
            # We redirect output to /dev/null to keep the terminal clean
            subprocess.run(
                ['ffmpeg', '-i', temp_mp3, '-ac', '1', '-ar', '44100', wav_path, '-y'],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=True
            )

            # C. Clean up temp file
            os.remove(temp_mp3)

        except Exception as e:
            print(f"FAILED on {s_id}: {e}")

    print("\nGeneration Complete.")

if __name__ == "__main__":
    generate_audio()

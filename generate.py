import json
import os
import subprocess
from gtts import gTTS

# --- CONFIGURATION ---
OUTPUT_FOLDER = "audio_output"

def generate_swir_direct():
    # 1. Create output folder
    if not os.path.exists(OUTPUT_FOLDER):
        os.makedirs(OUTPUT_FOLDER)

    # 2. Load sentences
    with open('sentences.json', 'r') as f:
        sentences = json.load(f)

    print(f"Found {len(sentences)} sentences. Generating WAVs using FFmpeg...")

    # 3. Loop through and process
    for item in sentences:
        text = item['text']
        file_id = item['id']

        # Define filenames
        temp_mp3 = f"{OUTPUT_FOLDER}/temp_{file_id}.mp3"
        final_wav = f"{OUTPUT_FOLDER}/swir_{file_id}.wav"

        # A. Generate MP3 (gTTS)
        tts = gTTS(text=text, lang='en', tld='us', slow=False)
        tts.save(temp_mp3)

        # B. Convert to WAV using system FFmpeg directly
        # -y = overwrite without asking
        # -i = input file
        cmd = ["ffmpeg", "-y", "-i", temp_mp3, final_wav]

        # Run the command silently (hide the messy logs)
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        # C. Delete the temp MP3
        if os.path.exists(temp_mp3):
            os.remove(temp_mp3)

        print(f"Generated: {final_wav} -> '{text}'")

    print("\nDone! All WAV files are in 'audio_output'.")

if __name__ == "__main__":
    generate_swir_direct()

import wave
import math
import os
import glob
import struct

def calculate_rms_amplitude(frames, width):
    # Unpack frames based on bit depth
    # Assuming mono or stereo, samples are interleaved. We just want raw amplitude here.
    
    count = len(frames) // width
    sum_squares = 0
    
    if width == 2: # 16-bit
        fmt = f"<{count}h" # Little-endian signed short
        samples = struct.unpack(fmt, frames)
    elif width == 1: # 8-bit unsigned
        fmt = f"<{count}B"
        # 8-bit is usually unsigned 0-255, center 128
        samples = [s - 128 for s in struct.unpack(fmt, frames)]
    else:
        # Fallback for 24/32 bit or other - simplistic check
        return 0

    for s in samples:
        sum_squares += s * s
        
    return math.sqrt(sum_squares / count)

def calculate_db_fs(file_path):
    try:
        with wave.open(file_path, 'rb') as wav:
            width = wav.getsampwidth()
            frames = wav.readframes(wav.getnframes())
            
            rms = calculate_rms_amplitude(frames, width)
            
            if rms == 0:
                return -float('inf')
                
            # Calculate dB relative to full scale
            # 16-bit max amplitude is 32768
            # 8-bit max is 128
            if width == 2:
                max_amp = 32768
            elif width == 1:
                max_amp = 128
            else:
                max_amp = 2**(8*width - 1)
                
            db = 20 * math.log10(rms / max_amp)
            return db
    except Exception as e:
        print(f"Error reading {file_path}: {e}")
        return None

def analyze_levels():
    base_dir = "audio_output"
    babble_path = os.path.join(base_dir, "babble_noise.wav")
    
    # Analyze Babble Noise
    babble_db = calculate_db_fs(babble_path)
    if babble_db is None:
        print("Could not read babble noise file.")
        return
        
    print(f"Babble Noise Level: {babble_db:.2f} dB")
    
    # Analyze Speech Files
    speech_files = glob.glob(os.path.join(base_dir, "Form */wav/swir_*.wav"))
    
    print(f"Analyzing {len(speech_files)} speech files...")
    
    valid_speech_dbs = []
    
    for f in speech_files:
        db = calculate_db_fs(f)
        if db is not None and db > -100: 
            valid_speech_dbs.append(db)
            
    if not valid_speech_dbs:
        print("No valid speech files found.")
        return

    avg_speech_db = sum(valid_speech_dbs) / len(valid_speech_dbs)
    print(f"Average Speech Level: {avg_speech_db:.2f} dB")
    
    diff = babble_db - avg_speech_db
    print(f"\nDifference (Babble - Speech): {diff:+.2f} dB")
    
    recommended_offset = -diff
    print(f"Recommended Offset: {recommended_offset:.2f} dB")

if __name__ == "__main__":
    analyze_levels()

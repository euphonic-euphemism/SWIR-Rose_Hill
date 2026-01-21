import os
import glob
import numpy as np
from scipy.io import wavfile
from scipy import signal

# CONFIGURATION
INPUT_FOLDER = "audio_output/Form A/wav"
OUTPUT_FILE = "audio_output/speech_shaped_noise.wav"
DURATION_SECONDS = 300  # How long the noise loop should be (5 minutes)

def create_speech_shaped_noise():
    print("Reading WAV files to analyze spectrum...")

    # 1. Load all WAVs and concatenate them into one giant array
    wav_files = glob.glob(os.path.join(INPUT_FOLDER, "swir_*.wav"))
    if not wav_files:
        print("No WAV files found! Run generate.py first.")
        return

    all_samples = []
    sample_rate = 0

    for wf in wav_files:
        sr, audio = wavfile.read(wf)
        sample_rate = sr
        # If stereo, take just one channel, otherwise take as is
        if len(audio.shape) > 1:
            all_samples.append(audio[:, 0])
        else:
            all_samples.append(audio)

    # Combine into one long signal
    full_signal = np.concatenate(all_samples)

    # 2. Normalize
    full_signal = full_signal / np.max(np.abs(full_signal))

    print("Calculating Long-Term Average Speech Spectrum (LTASS)...")

    # 3. Create a filter that matches this spectrum
    # We use a Linear Predictive Coding (LPC) method (simplified here via frequency envelope)
    # Actually, the easiest way to make SSN is to filter White Noise with the signal's spectral envelope.

    # Generate white noise for the desired duration
    num_samples_out = sample_rate * DURATION_SECONDS
    white_noise = np.random.randn(num_samples_out)

    # Get the spectral shape (order 50 filter is usually sufficient for speech)
    # We use LPC (Linear Prediction) to extract the spectral envelope
    # NOTE: "lpc" isn't in standard scipy, so we use a standard signal processing trick:
    # Filter white noise to match the magnitude spectrum of the speech.

    # Calculate FFT of the speech
    n_fft = 4096
    f, Pxx_den = signal.welch(full_signal, fs=sample_rate, nperseg=n_fft)

    # Create a filter design from this spectrum
    # (A simple FIR filter method)
    # We interpolate the spectrum to create a filter kernel
    b = signal.firwin2(1001, f, np.sqrt(Pxx_den), fs=sample_rate)

    # 4. Apply this filter to the white noise
    print("Filtering white noise to match speech spectrum...")
    ssn_audio = signal.lfilter(b, 1, white_noise)

    # 5. Normalize volume to be safe (peak at -1dB)
    ssn_audio = ssn_audio / np.max(np.abs(ssn_audio)) * 0.9

    # Convert to 16-bit PCM for writing
    ssn_int16 = (ssn_audio * 32767).astype(np.int16)

    # 6. Save
    wavfile.write(OUTPUT_FILE, sample_rate, ssn_int16)
    print(f"Success! Created {OUTPUT_FILE} ({DURATION_SECONDS}s loop)")

if __name__ == "__main__":
    create_speech_shaped_noise()

import React, { useState, useEffect, useRef } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import sentencesDataRaw from '../sentences.json';
import practiceSentencesRaw from '../practice_sentences.json';

// Merge datasets
const sentencesData = [...sentencesDataRaw, ...practiceSentencesRaw];

// Access the preloaded API, with a fallback for running in a normal browser
const audioBaseUrl = window.electronAPI ? window.electronAPI.getAudioBaseUrl() : './audio_output';

function App() {
  const [patientName, setPatientName] = useState('');
  const [testDate, setTestDate] = useState(new Date().toISOString().slice(0, 10));
  const [currentForm, setCurrentForm] = useState('P');
  const [currentBlock, setCurrentBlock] = useState(0);
  const [isPractice, setIsPractice] = useState(false);
  const [scores, setScores] = useState({ A: {}, B: {}, P: {} });
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentPlayingIndex, setCurrentPlayingIndex] = useState(null);
  const [showScoring, setShowScoring] = useState(false);
  // Timer State
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  // Strategy State
  const [strategyScores, setStrategyScores] = useState({ A: {}, B: {}, P: {} });
  const [hearingAidModels, setHearingAidModels] = useState({ A: '', B: '' });
  const [quickSIN, setQuickSIN] = useState('');

  const [isCalibrationPlaying, setIsCalibrationPlaying] = useState(false);
  const [noiseEnabled, setNoiseEnabled] = useState(false);
  const [snr, setSnr] = useState(15); // SNR in dB
  const [channelConfig, setChannelConfig] = useState('speech-left'); // 'speech-left' or 'speech-right'

  const audioRef = useRef(null);
  const audioContextRef = useRef(null);
  const speechPannerRef = useRef(null);
  const noisePannerRef = useRef(null);
  const calibrationRef = useRef(null);
  const noiseRef = useRef(null);
  const blockSentencesRef = useRef([]);

  // Logic Control Refs
  const isPlayingRef = useRef(false);
  const currentCancelRef = useRef(null);

  // Helper: Get Block Sizes based on Form
  const getBlockSizes = (form) => {
    if (form === 'P') return [3, 5];
    return [3, 4, 5, 6, 7]; // Standard for A and B
  };

  // Initialize Web Audio API for stereo control
  useEffect(() => {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audioContextRef.current = new AudioContext();

    // Create panners for speech and noise
    speechPannerRef.current = audioContextRef.current.createStereoPanner();
    noisePannerRef.current = audioContextRef.current.createStereoPanner();

    speechPannerRef.current.connect(audioContextRef.current.destination);
    noisePannerRef.current.connect(audioContextRef.current.destination);

    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  // Update panner positions when channel config changes
  useEffect(() => {
    if (speechPannerRef.current && noisePannerRef.current) {
      if (channelConfig === 'speech-left') {
        speechPannerRef.current.pan.value = -1; // Left
        noisePannerRef.current.pan.value = 1;   // Right
      } else {
        speechPannerRef.current.pan.value = 1;  // Right
        noisePannerRef.current.pan.value = -1;  // Left
      }
    }
  }, [channelConfig]);

  // 1. Initialize Noise Player (Only runs when Enabled toggles)
  useEffect(() => {
    if (noiseEnabled && audioContextRef.current && noisePannerRef.current) {
      if (audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume();
      }

      const noise = new Audio(`${audioBaseUrl}/babble_noise.wav`);
      noise.loop = true;
      noise.crossOrigin = 'anonymous';

      const source = audioContextRef.current.createMediaElementSource(noise);
      const gainNode = audioContextRef.current.createGain();

      // Initial volume setting will be handled by the second effect, but safer to start muted
      gainNode.gain.value = 0;

      source.connect(gainNode);
      gainNode.connect(noisePannerRef.current);

      noiseRef.current = { audio: noise, source, gainNode };
      noise.play().catch(err => console.warn('Noise playback failed:', err));
    }

    return () => {
      // Cleanup when disabled
      // Cleanup when disabled
      if (noiseRef.current) {
        if (noiseRef.current.audio) {
          noiseRef.current.audio.pause();
          noiseRef.current.audio.src = '';
          noiseRef.current.audio.load();
        }
        if (noiseRef.current.source) {
          try { noiseRef.current.source.disconnect(); } catch (e) { }
        }
        noiseRef.current = null;
      }
    };
  }, [noiseEnabled]);

  // 2. Adjust Volume Real-time (Runs when SNR or Enabled changes)
  useEffect(() => {
    if (noiseRef.current && noiseRef.current.gainNode) {
      // Calibration: Babble is ~1.5dB quieter than speech av (-23dB vs -21.5dB).
      // We apply +1.5dB to equalize them at 0 SNR.
      const BABBLE_OFFSET_DB = 1.5;

      // Formula: We want Noise to be `SNR` dB ABOVE/BELOW Speech.
      // Since Speech is 0dB (Reference), Noise should be -SNR.
      // Then apply offset.
      const targetDb = -snr + BABBLE_OFFSET_DB;

      // Convert dB to Gain
      const gain = Math.pow(10, targetDb / 20);

      // Smooth transition
      const currentTime = audioContextRef.current.currentTime;
      noiseRef.current.gainNode.gain.setTargetAtTime(gain, currentTime, 0.1);
    }
  }, [snr, noiseEnabled]);

  const handleQuickSinChange = (e) => {
    const val = e.target.value;
    setQuickSIN(val);

    if (val !== '') {
      // Auto-set SNR: QuickSIN + 10
      // Clamp to max 25
      const parsed = parseFloat(val);
      if (!isNaN(parsed)) {
        let newSnr = parsed + 10;
        if (newSnr > 25) newSnr = 25;
        if (newSnr < 0) newSnr = 0; // Should be impossible if QuickSIN >= 0, but good safety
        setSnr(newSnr);
        // Also ensure noise is enabled? User didn't ask, but SNR implies noise.
        // Let's leave noise enablement manual to avoid surprise.
      }
    }
  };

  const formSentences = sentencesData.filter(s => s.list === currentForm);

  useEffect(() => {
    // Reset when form changes
    setCurrentBlock(0);
    setShowScoring(false);
  }, [currentForm]);

  // Timer Logic
  useEffect(() => {
    let interval = null;
    if (isTimerRunning) {
      interval = setInterval(() => {
        setTimerSeconds(s => s + 1);
      }, 1000);
    } else if (!isTimerRunning && timerSeconds !== 0) {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [isTimerRunning, timerSeconds]);

  const formatTime = (totalSeconds) => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const toggleTimer = () => setIsTimerRunning(!isTimerRunning);
  const stopTimer = () => setIsTimerRunning(false);
  const resetTimer = () => {
    setIsTimerRunning(false);
    setTimerSeconds(0);
  };

  const getBlockRange = (blockNum) => {
    const sizes = getBlockSizes(currentForm);
    const start = sizes.slice(0, blockNum).reduce((a, b) => a + b, 0);
    const end = start + sizes[blockNum];
    return { start, end };
  };

  const getCurrentBlockSentences = () => {

    const { start, end } = getBlockRange(currentBlock);
    return formSentences.slice(start, end);
  };

  const getTotalScore = (formName) => {
    // Total Score = Percentage of sentences where the TARGET word was identified correctly? 
    // OR Percentage of ALL words?
    // Based on Benefit Score context (Target Words), likely Total Score is also Target Words.
    // But let's check getFormBlockStats from before.

    const formScores = scores[formName] || {};
    const formSents = sentencesData.filter(s => s.list === formName);
    let correct = 0;
    let total = 0;

    // In the previous version, getFormBlockStats iteration:
    // if (formScores[sentence.id] === true) correct++;
    // This implies formScores[sentence.id] was treated as a boolean in some contexts OR
    // maybe we should count TARGET words.

    // I will assume we score based on the TARGET word for consistency with Benefit Score.
    formSents.forEach(sentence => {
      const sentScore = formScores[sentence.id]; // Array of bools
      if (sentScore) {
        total++;
        // Check Target (Last Word for Form A/B?)
        // Generally sentences have 'target' field.
        // Find index of target word?
        const words = sentence.text.trim().split(/\s+/);
        const lastIndex = words.length - 1; // Assuming target is last word as per Protocol
        if (sentScore[lastIndex] === true) correct++;
      }
    });

    // Wait, Total Score usually counts total POSSIBLE sentences, not just scored ones?
    // The previous code had `scoredCount` and `correctCount`.
    // Let's use `formSents.length`.
    total = formSents.length;

    const percentage = total > 0 ? (correct / total * 100).toFixed(1) : 0;
    return { correct, total, percentage };
  };

  const getBenefitScore = (formName) => {
    const targetBlockIndices = [2, 3, 4]; // Sizes 5, 6, 7
    const formSents = sentencesData.filter(s => s.list === formName);
    const formScores = scores[formName] || {};

    let totalCorrect = 0;
    let totalPossible = 0;

    targetBlockIndices.forEach(blockIndex => {
      const { start, end } = getBlockRange(blockIndex);
      const blockSentences = formSents.slice(start, end);

      const startIndex = Math.max(0, blockSentences.length - 2);
      const recencySentences = blockSentences.slice(startIndex);

      recencySentences.forEach(sentence => {
        totalPossible++;
        // Check Target Word (Last Word)
        const sentScore = formScores[sentence.id]; // Array
        if (sentScore) {
          const words = sentence.text.trim().split(/\s+/);
          const lastIndex = words.length - 1;
          if (sentScore[lastIndex] === true) totalCorrect++;
        }
      });
    });

    const percentage = totalPossible > 0 ? (totalCorrect / totalPossible * 100).toFixed(1) : 0;
    return { correct: totalCorrect, total: totalPossible, percentage };
  };

  const getStrategyIndex = (formName) => {
    // Strategy Index = (Sentences where First Correct was Last Word / Total Scored Sentences) * 100
    const formStrategies = strategyScores[formName] || {};
    const entries = Object.values(formStrategies);
    // Note: older logic used Object.values which might include 'undefined'? No.
    // Filter boolean true

    // We need total *scored* sentences for denominator?
    // Using strategyScores count implies we only count sentences where a strategy outcome was determined (i.e. at least one word clicked).
    const totalScoredWithStrategy = entries.length;
    const recencyCount = entries.filter(v => v === true).length;

    const percentage = totalScoredWithStrategy > 0 ? (recencyCount / totalScoredWithStrategy * 100).toFixed(1) : 0;

    return { count: recencyCount, total: totalScoredWithStrategy, percentage };
  };

  const getFormBlockStats = (formName) => {
    const formSents = sentencesData.filter(s => s.list === formName);
    const formScores = scores[formName] || {};

    if (!formSents || formSents.length === 0) {
      return getBlockSizes(formName).map(() => ({ correct: 0, total: 0, percentage: 0 }));
    }

    return getBlockSizes(formName).map((size, blockNum) => {
      const { start, end } = getBlockRange(blockNum);
      const blockSentences = formSents.slice(start, end);

      let correct = 0;
      let total = 0;

      blockSentences.forEach(sentence => {
        total++;
        const sentScore = formScores[sentence.id];
        if (sentScore) {
          const words = sentence.text.trim().split(/\s+/);
          const lastIndex = words.length - 1;
          if (sentScore[lastIndex] === true) correct++;
        }
      });

      return { correct, total, percentage: total > 0 ? (correct / total * 100) : 0 };
    });
  };

  const playCalibration = async () => {
    if (!audioContextRef.current) return;

    setIsCalibrationPlaying(true);

    try {
      // Resume audio context if suspended
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      // Play left channel first
      await playCalibrationChannel(-1, 'Left');
      await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second pause

      // Then play right channel
      await playCalibrationChannel(1, 'Right');

      setIsCalibrationPlaying(false);
    } catch (err) {
      alert('Error playing calibration tone: ' + err.message);
      setIsCalibrationPlaying(false);
    }
  };

  const playCalibrationLeft = async () => {
    if (!audioContextRef.current) return;
    setIsCalibrationPlaying(true);

    try {
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }
      await playCalibrationChannel(-1, 'Left');
      setIsCalibrationPlaying(false);
    } catch (err) {
      alert('Error playing left calibration: ' + err.message);
      setIsCalibrationPlaying(false);
    }
  };

  const playCalibrationRight = async () => {
    if (!audioContextRef.current) return;
    setIsCalibrationPlaying(true);

    try {
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }
      await playCalibrationChannel(1, 'Right');
      setIsCalibrationPlaying(false);
    } catch (err) {
      alert('Error playing right calibration: ' + err.message);
      setIsCalibrationPlaying(false);
    }
  };

  const playSpeechNoiseLeft = async () => {
    if (!audioContextRef.current) return;
    setIsCalibrationPlaying(true);
    try {
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }
      await playCalibrationChannel(-1, 'Speech Left', 'speech_shaped_noise.wav');
      setIsCalibrationPlaying(false);
    } catch (err) {
      alert('Error playing speech noise left: ' + err.message);
      setIsCalibrationPlaying(false);
    }
  };

  const playSpeechNoiseRight = async () => {
    if (!audioContextRef.current) return;
    setIsCalibrationPlaying(true);
    try {
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }
      await playCalibrationChannel(1, 'Speech Right', 'speech_shaped_noise.wav');
      setIsCalibrationPlaying(false);
    } catch (err) {
      alert('Error playing speech noise right: ' + err.message);
      setIsCalibrationPlaying(false);
    }
  };

  /* Calibration Logic */

  const playCalibrationChannel = (panValue, channelName, filename = 'calibration_1khz_neg20db.wav') => {
    return new Promise((resolve, reject) => {
      const audio = new Audio(`${audioBaseUrl}/${filename}`);
      audio.crossOrigin = 'anonymous';

      const source = audioContextRef.current.createMediaElementSource(audio);
      const panner = audioContextRef.current.createStereoPanner();
      panner.pan.value = panValue;

      source.connect(panner);
      panner.connect(audioContextRef.current.destination);

      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error(`Calibration ${channelName} channel failed`));

      calibrationRef.current = { audio, source, panner };
      audio.play().catch(reject);
    });
  };

  const stopCalibration = () => {
    if (calibrationRef.current && calibrationRef.current.audio) {
      calibrationRef.current.audio.pause();
      calibrationRef.current.audio.currentTime = 0;
      setIsCalibrationPlaying(false);
    }
  };

  const playBlock = async () => {
    const blockSentences = getCurrentBlockSentences();
    blockSentencesRef.current = blockSentences;

    setIsPlaying(true);
    isPlayingRef.current = true;
    setShowScoring(false);
    console.log('[App] Playback started');

    let completed = false;

    try {
      for (let i = 0; i < blockSentences.length; i++) {
        console.log(`[App] Loop iteration ${i}, playing sentence ${blockSentences[i].id}`);
        // Check cancellation before start
        if (!isPlayingRef.current) throw new Error('Cancelled');

        const sentence = blockSentences[i];
        setCurrentPlayingIndex(i);

        const audioFilePath = `${audioBaseUrl}/Form ${currentForm}/wav/swir_${sentence.id}.wav`;

        // Play Audio with Cancellation Support
        await new Promise((resolve, reject) => {
          // Define cancellation for this step
          currentCancelRef.current = () => {
            reject(new Error('Cancelled'));
          };

          playAudioFile(audioFilePath)
            .then(resolve)
            .catch((err) => {
              // If we manually cancelled, the promise might reject naturally from stop() logic if implemented there,
              // or we reject here.
              reject(err);
            });
        });

        // Clear cancel ref after successful play
        currentCancelRef.current = null;

        // Check cancellation after play
        if (!isPlayingRef.current) throw new Error('Cancelled');

        console.log('[App] Waiting 3s...');
        // 3-second interstimulus interval (Cancellable)
        await new Promise((resolve, reject) => {
          currentCancelRef.current = () => reject(new Error('Cancelled'));
          setTimeout(() => {
            resolve();
            currentCancelRef.current = null;
          }, 3000);
        });
        currentCancelRef.current = null;
      }
      completed = true;
    } catch (err) {
      console.error('[App] Playback Error:', err);
      if (err.message === 'Cancelled') {
        console.log('[App] Playback sequence cancelled');
      } else {
        alert(`Error playing audio: ${err.message}`);
      }
    } finally {
      console.log('[App] Playback finally block entered');
      setIsPlaying(false);
      isPlayingRef.current = false;
      setCurrentPlayingIndex(null);
      currentCancelRef.current = null;
      if (completed) {
        setShowScoring(true);
      }
    }
  };

  const playSingleSentence = async (sentence) => {
    if (isPlayingRef.current) return;

    setIsPlaying(true);
    isPlayingRef.current = true;
    setCurrentPlayingIndex(formSentences.findIndex(s => s.id === sentence.id));

    try {
      const audioFilePath = `${audioBaseUrl}/Form ${currentForm}/wav/swir_${sentence.id}.wav`;

      await new Promise((resolve, reject) => {
        currentCancelRef.current = () => reject(new Error('Cancelled'));
        playAudioFile(audioFilePath)
          .then(resolve)
          .catch(reject);
      });

    } catch (err) {
      if (err.message !== 'Cancelled') {
        alert(`Error playing audio: ${err.message}`);
      }
    } finally {
      setIsPlaying(false);
      isPlayingRef.current = false;
      setCurrentPlayingIndex(null);
      currentCancelRef.current = null;
    }
  };

  const playAudioFile = async (path) => {
    // Ensure context exists
    if (!audioContextRef.current || !speechPannerRef.current) {
      throw new Error('Audio context not initialized');
    }

    // Resume audio context if suspended (Must await this!)
    if (audioContextRef.current.state === 'suspended') {
      console.log('[App] Resuming AudioContext...');
      await audioContextRef.current.resume();
      console.log('[App] AudioContext resumed');
    }

    return new Promise((resolve, reject) => {
      const audio = new Audio(path);
      audio.crossOrigin = 'anonymous';

      let source = null;

      try {
        source = audioContextRef.current.createMediaElementSource(audio);
        source.connect(speechPannerRef.current);
        audioRef.current = { audio, source };
      } catch (err) {
        reject(err);
        return;
      }

      // Safety timeout: forced resolve/reject if audio takes too long (e.g. 10s)
      const safetyTimeout = setTimeout(() => {
        console.warn('[App] Audio safety timeout triggered', path);
        resolve();
      }, 10000);

      // Cleanup function
      const cleanup = () => {
        clearTimeout(safetyTimeout);
        if (source) {
          try { source.disconnect(); } catch (e) { /* ignore */ }
        }
        // Optional: Release audio memory
        audio.src = '';
        audio.load();
      };

      audio.onended = () => {
        cleanup();
        resolve();
      };
      audio.onerror = (e) => {
        cleanup();
        console.error('[App] Audio error event:', e);
        reject(new Error('Audio file not found or cannot be played'));
      };

      console.log('[App] Calling audio.play()', path);
      audio.play().catch(err => {
        cleanup();
        console.error('[App] audio.play() failed:', err);
        reject(err);
      });
    });
  };

  const stopAudio = () => {
    console.log('[App] Stop requested');
    // 1. Mark as not playing to stop loop
    isPlayingRef.current = false;

    // 2. Trigger cancellation of current async wait
    if (currentCancelRef.current) {
      currentCancelRef.current();
      currentCancelRef.current = null;
    }

    // 3. Stop actual audio hardware
    if (audioRef.current && audioRef.current.audio) {
      audioRef.current.audio.pause();
      audioRef.current.audio.currentTime = 0;
    }

    // 4. Update UI State immediately (finally block will also run)
    setIsPlaying(false);
    setCurrentPlayingIndex(null);
  };

  const nextBlock = () => {
    const sizes = getBlockSizes(currentForm);
    // Stopping Rule: If Form A or B, and current + previous block are 0%, stop.
    if (['A', 'B'].includes(currentForm) && currentBlock > 0) {
      const currentStats = getFormBlockStats(currentForm)[currentBlock];
      const prevStats = getFormBlockStats(currentForm)[currentBlock - 1];

      if (currentStats.percentage === 0 && prevStats.percentage === 0) {
        // Trigger Stopping Rule
        alert(`Stopping Rule Triggered: Two consecutive sets with 0% correct.\n\nCompleting Form ${currentForm} with 0 score for remaining items.`);

        // Auto-score remaining blocks as 0 (False)
        const allSentenceIdsToFail = [];
        for (let b = currentBlock + 1; b < sizes.length; b++) {
          const { start, end } = getBlockRange(b);
          const sents = formSentences.slice(start, end);
          sents.forEach(s => allSentenceIdsToFail.push(s.id));
        }

        // Batch update scores
        setScores(prev => {
          const updatedForm = { ...prev[currentForm] };
          allSentenceIdsToFail.forEach(id => {
            // UpdatedForm is map of Id -> Array of Bools
            // Fail means everything false? Or target false?
            // Assuming empty array or explicitly all false
            // But we don't know word count easily here without lookup.
            // Just delete entry? OR Set empty?
            // Before changes, it was 'false' used in simple mode, but in word mode it expects array.
            // If initialized as array...
            // Look at reset: {}
            // If we assume un-scored is wrong, then removing key is fine.
            // But verify algorithm: getBlockStats checks `if (score)`
            // If key missing, score undefined -> not correct.
            delete updatedForm[id];
          });
          return {
            ...prev,
            [currentForm]: updatedForm
          };
        });

        // Jump to end (or stay on last block to show results?)
        // Let's jump to the last block so the "Next" button disappears and graphs update
        setCurrentBlock(sizes.length - 1);
        setShowScoring(false);
        return;
      }
    }

    if (currentBlock < sizes.length - 1) {
      setCurrentBlock(currentBlock + 1);
      setShowScoring(false);
    } else {
      alert('This is the last block in the form.');
    }
  };

  const previousBlock = () => {
    if (currentBlock > 0) {
      setCurrentBlock(currentBlock - 1);
      setShowScoring(false);
    } else {
      alert('This is the first block in the form.');
    }
  };

  const toggleWordScore = (sentenceId, wordIndex, isCorrect) => {
    // Update Score
    setScores(prev => {
      const currentFormScores = prev[currentForm] || {}; // This makes sure we don't crash if undefined
      const currentSentenceScores = currentFormScores[sentenceId] || []; // Array of bools

      // Copy array or create new one enough to hold index
      const newSentenceScores = [...currentSentenceScores];
      newSentenceScores[wordIndex] = isCorrect;

      return {
        ...prev,
        [currentForm]: {
          ...currentFormScores,
          [sentenceId]: newSentenceScores
        }
      };
    });

    // Strategy Index Logic
    // If marking as correct, check if this is the first correct mark for this sentence
    if (isCorrect) {
      setStrategyScores(prev => {
        const formStrategies = prev[currentForm] || {};

        // If we already have a strategy verdict for this sentence, do NOT overwrite it.
        // History is preserved (First move counts).
        if (formStrategies[sentenceId] !== undefined) {
          return prev;
        }

        // Check if any OTHER words are currently correct in the *previous* state
        const currentSentenceScores = scores[currentForm][sentenceId] || [];
        const hasExistingCorrect = currentSentenceScores.some(s => s === true);

        if (!hasExistingCorrect) {
          // This is the FIRST correct mark.
          // Check if it is the LAST word.
          const sentence = sentencesData.find(s => s.id === sentenceId);
          if (sentence) {
            const wordCount = sentence.text.trim().split(/\s+/).length;
            const isLastWord = wordIndex === wordCount - 1;

            return {
              ...prev,
              [currentForm]: {
                ...formStrategies,
                [sentenceId]: isLastWord
              }
            };
          }
        }
        return prev;
      });
    }
  };



  const startNewTest = () => {
    if (window.confirm("Start a new test? This will clear all current data (Patient Name, Scores, Timer).")) {
      // Blur current button
      if (document.activeElement) {
        document.activeElement.blur();
      }

      setPatientName('');
      setTestDate(new Date().toISOString().split('T')[0]);
      setScores({ A: {}, B: {}, P: {} });
      setStrategyScores({ A: {}, B: {}, P: {} });
      setHearingAidModels({ A: '', B: '' });
      setQuickSIN('');
      setTimerSeconds(0);
      setIsTimerRunning(false);
      setCurrentForm('A');
      setCurrentBlock(0);
      setShowScoring(false);
      setIsPractice(false);

      // Explicitly focus Patient Name with a multi-step retry for slower environments (Electron/Linux)
      const forceFocus = () => {
        const patientInput = document.getElementById('patientName');
        if (patientInput) {
          // Sometimes a click event helps wake up the input in strict window managers
          patientInput.click();
          patientInput.focus();
        }
      };

      // Try immediately
      setTimeout(forceFocus, 50);
      // Try again slightly later in case of render/window lag
      setTimeout(forceFocus, 300);
    }
  };

  /* Database Functionality */
  // Load database from localStorage on mount
  const [testDatabase, setTestDatabase] = useState([]);

  useEffect(() => {
    try {
      const storedDb = localStorage.getItem('swir_test_database');
      if (storedDb) {
        setTestDatabase(JSON.parse(storedDb));
      }
    } catch (err) {
      console.error('Failed to load database from localStorage', err);
    }
  }, []);

  // Save database to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('swir_test_database', JSON.stringify(testDatabase));
  }, [testDatabase]);

  const saveToDatabase = () => {
    if (!patientName) {
      alert('Please enter a Patient Name before saving to the database.');
      return;
    }
    const newRecord = {
      id: Date.now(), // Simple unique ID
      patientName,
      testDate,
      scores,
      strategyScores,
      hearingAidModels,
      quickSIN,
      timestamp: new Date().toISOString()
    };

    setTestDatabase(prev => [...prev, newRecord]);
    alert('Test saved to local database!');
  };

  const exportDatabase = () => {
    if (testDatabase.length === 0) {
      alert('Database is empty.');
      return;
    }
    const fileName = `swir_database_export_${new Date().toISOString().slice(0, 10)}.json`;
    const jsonStr = JSON.stringify(testDatabase, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const importDatabase = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importedData = JSON.parse(event.target.result);
        if (!Array.isArray(importedData)) {
          throw new Error('File does not contain an array of records.');
        }

        // Merge strategy: Prevent exact duplicates based on timestamp/id?
        // Simple Append for now, or check ID
        setTestDatabase(prev => {
          const existingIds = new Set(prev.map(r => r.id));
          const newRecords = importedData.filter(r => !existingIds.has(r.id));

          if (newRecords.length < importedData.length) {
            alert(`Imported ${newRecords.length} new records. (${importedData.length - newRecords.length} duplicates skipped)`);
          } else {
            alert(`Successfully imported ${newRecords.length} records.`);
          }

          return [...prev, ...newRecords];
        });
      } catch (err) {
        alert('Error importing database: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const clearDatabase = () => {
    if (window.confirm('Are you sure you want to clear the entire local database? This cannot be undone.')) {
      setTestDatabase([]);
    }
  };

  /* Save / Load Functionality (Single Session) */
  const savePatientData = () => {
    const data = {
      patientName,
      testDate,
      scores,
      strategyScores,
      hearingAidModels,
      quickSIN,
      currentForm, // Optional: restore their place?
      currentBlock // Optional
    };

    const fileName = `swir_patient_${patientName.replace(/\s+/g, '_') || 'unnamed'}_${testDate}.json`;
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const loadPatientData = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);

        // Restore State
        if (data.patientName !== undefined) setPatientName(data.patientName);
        if (data.testDate !== undefined) setTestDate(data.testDate);
        if (data.scores) setScores(data.scores);
        if (data.strategyScores) setStrategyScores(data.strategyScores);
        if (data.hearingAidModels) setHearingAidModels(data.hearingAidModels);
        if (data.quickSIN !== undefined) setQuickSIN(data.quickSIN);

        // Optional: Restore form/place
        if (data.currentForm) setCurrentForm(data.currentForm);
        if (data.currentBlock !== undefined) setCurrentBlock(data.currentBlock);

        alert(`Successfully loaded patient data for ${data.patientName || 'Unnamed'}`);
      } catch (err) {
        alert('Error parsing patient file: ' + err.message);
      }
    };
    reader.readAsText(file);
    // Reset input so same file can be loaded again if needed
    e.target.value = '';
  };

  const simulateTest = () => {
    if (window.confirm("Load simulated test data? This will overwrite current data.")) {
      setPatientName('Simulated Test Patient');
      setTestDate(new Date().toISOString().split('T')[0]);

      const newScores = { A: {}, B: {}, P: {} };
      const newStrategyScores = { A: {}, B: {}, P: {} };

      ['A', 'B'].forEach(form => {
        const formSents = sentencesData.filter(s => s.list === form);

        const sizes = getBlockSizes(form); // Use form-specific block sizes
        sizes.forEach((size, blockIndex) => {
          // Calculate probability of correct recall based on set size
          // AGGRESSIVE DECAY: Size 3 -> 0.80, Size 7 -> 0.08
          const baseProb = 0.80 - (blockIndex * 0.18);

          const { start, end } = getBlockRange(blockIndex);
          const blockSentences = formSents.slice(start, end);

          blockSentences.forEach(sentence => {
            // High variance: +/- 20%
            const sentenceProb = baseProb + (Math.random() * 0.4 - 0.2);
            // Clamp
            const effectiveProb = Math.max(0.05, Math.min(0.95, sentenceProb));

            // Simulate Strategy
            const isCorrect = Math.random() < effectiveProb;
            const words = sentence.text.trim().split(/\s+/);
            const wordCount = words.length;

            // New structure: words array
            const simulatedWords = new Array(wordCount).fill(false);

            if (isCorrect) {
              // Mark target (last) word as correct
              simulatedWords[wordCount - 1] = true;

              // Randomly other words
              for (let i = 0; i < wordCount - 1; i++) {
                if (Math.random() < 0.8) simulatedWords[i] = true;
              }

              // Strategy logic (handled by setStrategyScores in simulation)
              if (Math.random() < 0.6) {
                newStrategyScores[form][sentence.id] = true;
              }
            } else {
              newStrategyScores[form][sentence.id] = false;
            }

            newScores[form][sentence.id] = simulatedWords;
          });
        });
      });

      setScores(newScores);
      setStrategyScores(newStrategyScores); // This will be removed later as strategy is in scores
      setCurrentForm('A');
      setCurrentBlock(0);
      setShowScoring(false);
      setIsPractice(false);
    }
  };

  const exportResults = () => {
    const safePatientName = patientName.replace(/[^a-zA-Z0-9]/g, '_') || 'unnamed';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `audiometry_results_${safePatientName}_${timestamp}.txt`;

    let content = `Speech Audiometry Results\n`;
    content += '='.repeat(80) + '\n';
    content += `Patient Name: ${patientName}\n`;
    content += `Test Date: ${testDate}\n`;
    content += `Timer Duration: ${formatTime(timerSeconds)}\n`;
    content += '='.repeat(80) + '\n\n';

    // Helper to print stats for a form
    const printFormStats = (formName) => {
      const formScores = scores[formName];
      const totalScore = getTotalScore(formName);

      if (totalScore.total === 0) return '';

      let section = `--- FORM ${formName} ---\n`;
      if (hearingAidModels[formName]) {
        section += `Hearing Aid Model: ${hearingAidModels[formName]}\n`;
      }
      section += `Total Score: ${totalScore.percentage}% (${totalScore.correct}/${totalScore.total})\n`;

      const benefit = getBenefitScore(formName);
      if (benefit.total > 0) {
        section += `Benefit Score (Sets 5,6,7): ${benefit.percentage}% (${benefit.correct}/${benefit.total})\n`;
      }

      const strategy = getStrategyIndex(formName);
      if (strategy.total > 0) {
        section += `Strategy Index: ${strategy.percentage}% (${strategy.count}/${strategy.total} sentences)\n`;
      }
      section += '\n';
      return section;
    };

    content += printFormStats('A');
    content += printFormStats('B');

    // Net Benefit
    const benA = getBenefitScore('A');
    const benB = getBenefitScore('B');
    if (benA.total > 0 && benB.total > 0) {
      const net = Math.abs(parseFloat(benB.percentage) - parseFloat(benA.percentage)).toFixed(1);
      content += `Net Benefit (Form B - Form A): ${net}%\n\n`;
    }

    content += printFormStats('P'); // Practice if needed

    content += 'DETAILED LOG:\n';
    content += '-'.repeat(80) + '\n';

    formSentences.forEach(sentence => {
      const scoreArray = scores[currentForm][sentence.id];
      let result = 'NOT SCORED';
      let otherInfo = '';

      if (scoreArray) {
        // Check words
        const words = sentence.text.trim().split(/\s+/);
        const lastWordIndex = words.length - 1;
        const isTargetCorrect = scoreArray[lastWordIndex] === true;

        if (isTargetCorrect) {
          result = 'CORRECT';
          // List all correct words?
          const correctWords = words.filter((_, idx) => scoreArray[idx]).join(', ');
          otherInfo = ` (Words: ${correctWords})`;
        } else {
          result = 'INCORRECT';
        }
      }

      const sStrat = strategyScores[currentForm] && strategyScores[currentForm][sentence.id];
      if (sStrat) otherInfo += ' (Strategy Used)';

      content += `ID: ${sentence.id}\n`;
      content += `Sentence: ${sentence.text}\n`;
      content += `Target: ${sentence.target}\n`;
      content += `Result: ${result}${otherInfo}\n`;
      content += '-'.repeat(80) + '\n';
    });

    content += '\nSUMMARY\n';
    content += '='.repeat(80) + '\n';
    const totalScoreSummary = getTotalScore(currentForm);
    if (totalScoreSummary.total > 0) {
      content += `Scored: ${totalScoreSummary.total} sentences\n`;
      content += `Correct: ${totalScoreSummary.correct}/${totalScoreSummary.total} = ${totalScoreSummary.percentage}%\n`;
    } else {
      content += 'No sentences scored.\n';
    }

    // Create and download file
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);

    alert(`Results exported to: ${filename}`);
  };

  const generatePdf = () => {
    // Generate PDF with Graph
    const doc = new jsPDF();

    doc.setFontSize(18);
    doc.text('Speech Audiometry Results', 14, 20);

    doc.setFontSize(12);
    doc.text(`Patient Name: ${patientName}`, 14, 30);
    doc.text(`Test Date: ${testDate}`, 14, 40);
    doc.text(`Timer Duration: ${formatTime(timerSeconds)}`, 14, 50);

    // Header Stats for Form A and B
    doc.setFontSize(10);

    // Helper to get stats
    const getStats = (f) => {
      const fScores = scores[f];
      const totalScore = getTotalScore(f);
      if (totalScore.total === 0) return null;
      const pct = totalScore.percentage;
      const count = `${totalScore.correct}/${totalScore.total}`;
      const ben = getBenefitScore(f);
      const strat = getStrategyIndex(f);
      return { pct, count, ben, strat };
    };

    const statsA = getStats('A');
    const statsB = getStats('B');

    // Right side column X positions
    const col1X = 120;
    const col2X = 160;
    let currentY = 30;

    if (statsA) {
      doc.setTextColor(102, 126, 234); // Purple for A
      doc.text(`FORM A`, col1X, currentY);
      doc.setTextColor(0);
      doc.text(`${statsA.pct}% (${statsA.count})`, col1X, currentY + 5);
      if (statsA.ben.total > 0) doc.text(`Ben: ${statsA.ben.percentage}%`, col1X, currentY + 10);
      if (statsA.strat.total > 0) doc.text(`Strat: ${statsA.strat.percentage}%`, col1X, currentY + 15);
    }

    if (statsB) {
      doc.setTextColor(255, 159, 67); // Orange for B
      doc.text(`FORM B`, col2X, currentY);
      doc.setTextColor(0);
      doc.text(`${statsB.pct}% (${statsB.count})`, col2X, currentY + 5);
      if (statsB.ben.total > 0) doc.text(`Ben: ${statsB.ben.percentage}%`, col2X, currentY + 10);
      if (statsB.strat.total > 0) doc.text(`Strat: ${statsB.strat.percentage}%`, col2X, currentY + 15);
    }

    // Net Benefit
    if (statsA && statsB && statsA.ben.total > 0 && statsB.ben.total > 0) {
      const net = Math.abs(parseFloat(statsB.ben.percentage) - parseFloat(statsA.ben.percentage)).toFixed(1);
      doc.setFontSize(11);
      doc.text(`Net Benefit: ${net}%`, 140, currentY + 25);
    }

    // Draw Graph instead of Table

    const startX = 20;
    const startY = 80;
    const graphWidth = 160;
    const graphHeight = 100;
    const maxVal = 100;

    // Draw Title
    doc.setFontSize(14);
    doc.text(`Performance Comparison (Combined)`, 14, 70);

    // Draw Axis
    doc.setLineWidth(0.5);
    doc.line(startX, startY + graphHeight, startX + graphWidth, startY + graphHeight); // X Axis
    doc.line(startX, startY, startX, startY + graphHeight); // Y Axis

    // Draw Y Axis Labels and Grid lines
    doc.setFontSize(10);
    [0, 25, 50, 75, 100].forEach(percent => {
      const y = startY + graphHeight - (percent / 100 * graphHeight);
      doc.text(`${percent}%`, startX - 2, y + 3, { align: 'right' });
      doc.setDrawColor(200);
      doc.line(startX, y, startX + graphWidth, y); // Grid line
    });

    doc.setDrawColor(0); // Reset to black

    // Draw Legend
    doc.setFontSize(10);
    // Legend A
    doc.setFillColor(102, 126, 234); // #667eea (Purple)
    doc.rect(startX + graphWidth - 60, startY - 10, 4, 4, 'F');
    doc.text('Form A', startX + graphWidth - 54, startY - 7);

    // Legend B
    doc.setFillColor(255, 159, 67); // #ff9f43 (Orange)
    doc.rect(startX + graphWidth - 30, startY - 10, 4, 4, 'F');
    doc.text('Form B', startX + graphWidth - 24, startY - 7);

    // Draw Bars
    const barWidth = 15;

    // Calculate stats for BOTH forms
    const statsA_blocks = getFormBlockStats('A');
    const statsB_blocks = getFormBlockStats('B');

    const sizesA = getBlockSizes('A'); // Comparison is usually valid for A/B standard sizes
    sizesA.forEach((size, i) => {
      const sectionWidth = graphWidth / sizesA.length;
      const groupCenterX = startX + (sectionWidth * i) + (sectionWidth / 2);

      const xA = groupCenterX - barWidth - 1; // Shift left
      const xB = groupCenterX + 1; // Shift right

      // Draw Bar A
      const sA = statsA_blocks[i];
      const hA = (sA.percentage / 100) * graphHeight;
      const yA = startY + graphHeight - hA;

      doc.setFillColor(102, 126, 234); // Purple
      if (sA.percentage > 0) {
        doc.rect(xA, yA, barWidth, hA, 'F');
      }

      // Draw Bar B
      const sB = statsB_blocks[i];
      const hB = (sB.percentage / 100) * graphHeight;
      const yB = startY + graphHeight - hB;

      doc.setFillColor(255, 159, 67); // Orange
      if (sB.percentage > 0) {
        doc.rect(xB, yB, barWidth, hB, 'F');
      }

      // Draw Labels (only if > 0)
      doc.setTextColor(0);
      doc.setFontSize(8);
      if (sA.percentage > 0) doc.text(`${sA.percentage.toFixed(0)}%`, xA + barWidth / 2, yA - 2, { align: 'center' });
      if (sB.percentage > 0) doc.text(`${sB.percentage.toFixed(0)}%`, xB + barWidth / 2, yB - 2, { align: 'center' });

      // X Label
      doc.setFontSize(10);
      doc.text(`${size}`, groupCenterX, startY + graphHeight + 5, { align: 'center' });
      doc.setFontSize(8);
      doc.text(`sentences`, groupCenterX, startY + graphHeight + 9, { align: 'center' });
      doc.setFontSize(10);
    });

    // X Axis Title
    doc.text('Set Size', startX + graphWidth / 2, startY + graphHeight + 15, { align: 'center' });

    const safePatientName = patientName.replace(/[^a-zA-Z0-9]/g, '_') || 'unnamed';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    doc.save(`audiometry_report_${safePatientName}_${timestamp}.pdf`);
  };

  const blockSentences = getCurrentBlockSentences();
  const blockSize = getBlockSizes(currentForm)[currentBlock];
  const targets = blockSentences.map(s => s.target).join(', ');

  // Calculate summary stats
  const totalFormScore = getTotalScore(currentForm);
  const percentage = totalFormScore.percentage;
  const correctCount = totalFormScore.correct;
  const scoredCount = totalFormScore.total;

  const benefitStats = getBenefitScore(currentForm);
  const strategyStats = getStrategyIndex(currentForm);

  // Calculate block statistics for graph
  const blockStats = getBlockSizes(currentForm).map((size, index) => getFormBlockStats(currentForm)[index]);
  const allScored = scoredCount > 0 && scoredCount === formSentences.length; // This logic might need adjustment based on 'no_response'

  return (
    <div className="app">
      <h1>SWIR - Rose Hill Clinical Version v1.1.4</h1>

      {/* Patient Info Section */}
      <div className="section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <div className="section-title" style={{ marginBottom: 0 }}>Patient Information</div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={simulateTest}
              style={{
                backgroundColor: '#9c27b0',
                color: 'white',
                border: 'none',
                padding: '8px 16px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '0.9em'
              }}
            >
              Load Simulated Patient
            </button>
            <button
              onClick={startNewTest}
              style={{
                backgroundColor: '#ff9800',
                color: 'white',
                border: 'none',
                padding: '8px 16px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 'bold'
              }}
            >
              New Test
            </button>
            <div style={{ width: '1px', background: '#ccc', margin: '0 5px' }}></div>
            <button
              onClick={savePatientData}
              className="btn btn-secondary"
              style={{ padding: '8px 16px', fontSize: '0.9em' }}
            >
              💾 Save Patient
            </button>
            <button
              onClick={() => document.getElementById('loadPatientInput').click()}
              className="btn btn-secondary"
              style={{ padding: '8px 16px', fontSize: '0.9em' }}
            >
              📂 Load Patient
            </button>
            <input
              type="file"
              id="loadPatientInput"
              accept=".json"
              style={{ display: 'none' }}
              onChange={loadPatientData}
            />
          </div>
        </div>
        <div className="patient-info-grid">
          <div className="input-group">
            <label htmlFor="patientName">Patient Name</label>
            <input
              type="text"
              id="patientName"
              value={patientName}
              onChange={(e) => setPatientName(e.target.value)}
              placeholder="Enter patient's name"
            />
          </div>
          <div className="input-group">
            <label htmlFor="testDate">Test Date</label>
            <input
              type="date"
              id="testDate"
              value={testDate}
              onChange={(e) => setTestDate(e.target.value)}
            />
          </div>
          <div className="input-group">
            <label htmlFor="quickSIN">QuickSIN Score (dB)</label>
            <input
              type="number"
              id="quickSIN"
              value={quickSIN}
              onChange={handleQuickSinChange}
              placeholder="Enter Score"
              title="Sets SNR to Score + 10dB automatically"
            />
          </div>
        </div>
      </div>

      {/* Timer Controls */}
      <div className="section">
        <div className="section-title">Test Timer</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ fontSize: '32px', fontWeight: 'bold', fontFamily: 'monospace', minWidth: '100px' }}>
            {formatTime(timerSeconds)}
          </div>
          <div>
            {!isTimerRunning ? (
              <button
                onClick={toggleTimer}
                className="btn btn-primary"
                style={{ marginRight: '10px', backgroundColor: '#28a745' }}
              >
                Start
              </button>
            ) : (
              <button
                onClick={toggleTimer}
                className="btn"
                style={{ marginRight: '10px', backgroundColor: '#ffc107', color: 'black' }}
              >
                Pause
              </button>
            )}
            <button
              onClick={stopTimer}
              className="btn"
              style={{ marginRight: '10px', backgroundColor: '#dc3545', color: 'white' }}
            >
              Stop
            </button>
            <button
              onClick={resetTimer}
              className="btn btn-secondary"
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      {/* Form Selection */}
      <div className="section">
        <div className="section-title">Form Selection</div>
        <div className="form-selection">
          <div className="btn-group" style={{ display: 'flex', gap: '10px' }}>
            <button
              className={`btn ${currentForm === 'P' ? 'btn-warning' : 'btn-secondary'}`}
              onClick={() => { setCurrentForm('P'); setIsPractice(true); setCurrentBlock(0); }}
              disabled={isPlaying || isCalibrationPlaying}
            >
              Practice
            </button>
            <button
              className={`btn ${currentForm === 'A' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => { setCurrentForm('A'); setIsPractice(false); }}
              disabled={isPlaying || isCalibrationPlaying}
            >
              Form A
            </button>
            <button
              className={`btn ${currentForm === 'B' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => { setCurrentForm('B'); setIsPractice(false); }}
              disabled={isPlaying || isCalibrationPlaying}
            >
              Form B
            </button>
          </div>
          <div className="separator"></div>
          {!isCalibrationPlaying ? (
            <>
              <div className="calibration-buttons">
                <span style={{ marginRight: '10px', fontSize: '0.9em', display: 'inline-block', width: '140px', textAlign: 'right' }}>Calibration Tone:</span>
                <button className="btn btn-secondary" onClick={playCalibrationLeft} style={{ width: '160px', flex: 'none' }}>
                  🔊 1kHz Left
                </button>
                <button className="btn btn-secondary" onClick={playCalibrationRight} style={{ width: '160px', flex: 'none' }}>
                  🔊 1kHz Right
                </button>
              </div>
              <div className="calibration-buttons" style={{ marginTop: '5px' }}>
                <span style={{ marginRight: '10px', fontSize: '0.9em', display: 'inline-block', width: '140px', textAlign: 'right' }}>Speech Noise:</span>
                <button className="btn btn-secondary" onClick={playSpeechNoiseLeft} style={{ width: '160px', flex: 'none' }}>
                  🔊 Left
                </button>
                <button className="btn btn-secondary" onClick={playSpeechNoiseRight} style={{ width: '160px', flex: 'none' }}>
                  🔊 Right
                </button>
              </div>
            </>
          ) : (
            <button className="btn btn-danger" onClick={stopCalibration}>
              ⏸ Stop Calibration
            </button>
          )}
        </div>
      </div>

      {/* Standard Form View - Now Enabled for Practice too */}
      {(
        <>
          {/* Current Block Info */}
          <div className="section">
            <div className="section-title">Current Block</div>

            {/* Hearing Aid Model Input */}
            <div className="input-group" style={{ marginBottom: '15px' }}>
              <label htmlFor="haModel">Hearing Aid Model (Form {currentForm})</label>
              <input
                type="text"
                id="haModel"
                value={hearingAidModels[currentForm]}
                onChange={(e) => setHearingAidModels(prev => ({ ...prev, [currentForm]: e.target.value }))}
                placeholder={`Enter HA Model for Form ${currentForm}`}
                style={{ width: '100%', padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }}
              />
            </div>

            <div className="block-info">
              <h3>Block {currentBlock + 1}/{getBlockSizes(currentForm).length} ({blockSize} sentences)</h3>
              {isPlaying && currentPlayingIndex !== null ? (
                <>
                  <div className="sentence-text">
                    Playing: ID {blockSentences[currentPlayingIndex].id}
                  </div>
                  <div className="sentence-text">
                    {blockSentences[currentPlayingIndex].text}
                  </div>
                  <div className="target-word">
                    Target Word: {blockSentences[currentPlayingIndex].target}
                  </div>
                </>
              ) : (
                <>
                  <div className="sentence-text">Ready to play block {currentBlock + 1}</div>
                  <div className="target-word">Target words: {targets}</div>
                </>
              )}
            </div>
          </div>

          {/* Playback Controls */}
          <div className="section">
            <div className="section-title">Playback Controls</div>
            <div className="control-buttons">
              <button className="btn" onClick={previousBlock} disabled={isPlaying}>
                ⏮ Previous Block
              </button>
              <button className="btn" onClick={playBlock} disabled={isPlaying}>
                ▶ Play Block
              </button>
              <button className="btn btn-secondary" onClick={stopAudio} disabled={!isPlaying}>
                ⏸ Stop
              </button>
              <button className="btn" onClick={nextBlock} disabled={isPlaying}>
                Next Block ⏭
              </button>
            </div>
            <div className="noise-control">
              <label className="noise-toggle">
                <input
                  type="checkbox"
                  checked={noiseEnabled}
                  onChange={(e) => setNoiseEnabled(e.target.checked)}
                  disabled={isPlaying}
                />
                <span>Add Background Noise</span>
              </label>
              {noiseEnabled && (
                <div className="snr-control">
                  <label className="snr-label">
                    <span>SNR: {snr > 0 ? '+' : ''}{snr} dB</span>
                    <input
                      type="range"
                      min="0"
                      max="25"
                      step="1"
                      value={snr}
                      onChange={(e) => setSnr(parseInt(e.target.value))}
                      disabled={isPlaying}
                      className="snr-slider"
                    />
                    <div className="snr-range-labels">
                      <span>0 dB</span>
                      <span>12 dB</span>
                      <span>25 dB</span>
                    </div>
                  </label>
                </div>
              )}
            </div>

            {/* Channel Configuration */}
            <div className="channel-control">
              <div className="section-subtitle">Channel Configuration</div>
              <div className="channel-buttons">
                <button
                  className={`btn-channel ${channelConfig === 'speech-left' ? 'active' : ''}`}
                  onClick={() => setChannelConfig('speech-left')}
                  disabled={isPlaying || isCalibrationPlaying}
                >
                  Speech Left / Noise Right
                </button>
                <button
                  className={`btn-channel ${channelConfig === 'speech-right' ? 'active' : ''}`}
                  onClick={() => setChannelConfig('speech-right')}
                  disabled={isPlaying || isCalibrationPlaying}
                >
                  Speech Right / Noise Left
                </button>
              </div>
            </div>
          </div>

          {/* Scoring */}
          <div className="section">
            <div className="section-title">Score Block (after playback)</div>
            <div className="scoring-container">
              {showScoring ? (
                <>
                  <div className="scoring-title">Score each target word:</div>
                  <div className="scoring-grid">
                    {blockSentences.map((sentence, idx) => {
                      const scoreArray = scores[currentForm][sentence.id] || [];
                      const isCurrent = currentPlayingIndex === idx;

                      return (
                        <div key={sentence.id} className="scoring-row" style={{
                          backgroundColor: isCurrent ? '#e3f2fd' : 'transparent',
                          border: isCurrent ? '2px solid #2196f3' : '1px solid transparent'
                        }}>
                          <div className="sentence-text-display">
                            {/* Word Clicking Interface */}
                            {sentence.text.trim().split(/\s+/).map((word, wIdx) => {
                              const cleanWord = word.replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, "").toLowerCase();
                              const target = sentence.target.toLowerCase();

                              // Check if cleanWord *ends with* target (e.g. 'oclock' ends with 'clock')
                              // Also verify length difference is reasonable (e.g. at most 2 chars difference? 'o' + 'clock' = 6 vs 5)
                              // Simple endsWith is likely enough for fixed sentences.
                              const isTarget = cleanWord === target || (cleanWord.endsWith(target) && cleanWord.length <= target.length + 2);

                              // Use scoreArray index... wait if split differs, index differs.
                              // scoreArray assumes a fixed mapping.
                              // If previously split by ' ', and now by regex, result should be same for normal text.
                              // If text had double spaces, split(' ') gives empty strings. split(/\s+/) removes them.
                              // This is BETTER.

                              // We must ensure the scoreArray mapping aligns with this split.
                              // toggleWordScore uses logic? It uses index.
                              // When initializing/scoring, we just use the index.
                              // So as long as we consistently split, it's fine.

                              const isWordScored = scoreArray[wIdx] === true;

                              return (
                                <span
                                  key={wIdx}
                                  onClick={() => toggleWordScore(sentence.id, wIdx, !isWordScored)}
                                  style={{
                                    fontWeight: isTarget ? 'bold' : 'normal',
                                    marginRight: '6px',
                                    cursor: 'pointer',
                                    padding: '2px 5px',
                                    borderRadius: '4px',
                                    backgroundColor: isWordScored ? '#d4edda' : (isTarget ? '#e7f1ff' : 'transparent'),
                                    color: isWordScored ? '#155724' : (isTarget ? '#007bff' : '#333'),
                                    border: isWordScored ? '1px solid #c3e6cb' : '1px solid transparent',
                                    transition: 'all 0.1s'
                                  }}>
                                  {word}
                                </span>
                              );
                            })}
                          </div>
                          {/* No Buttons */}
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="empty-state">Play a block to begin scoring</div>
              )}
            </div>
          </div>

          {/* Results */}
          <div className="section">
            <div className="section-title">Form {currentForm} Results</div>
            <div className="results-section">
              <table className="results-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Sentence</th>
                    <th>Target Word</th>
                    <th>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {formSentences.map(s => {
                    const score = scores[currentForm][s.id];
                    const scoreMark = score === undefined ? '-' : score ? '✓' : '✗';
                    const scoreClass = score === undefined ? 'unscored' : score ? 'correct' : 'incorrect';
                    return (
                      <tr key={s.id} className={scoreClass}>
                        <td className="id-cell">{s.id}</td>
                        <td className="sentence-cell">{s.text}</td>
                        <td className="target-cell">{s.target}</td>
                        <td className="score-cell">{scoreMark}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="results-summary">
                {scoredCount > 0
                  ? (
                    <>
                      <div className="summary-stat">
                        <span className="stat-label">Scored:</span>
                        <span className="stat-value">{scoredCount}/{formSentences.length} sentences</span>
                      </div>
                      <div className="summary-stat">
                        <span className="stat-label">Correct:</span>
                        <span className="stat-value">{correctCount}/{scoredCount} ({percentage}%)</span>
                      </div>
                    </>
                  )
                  : <div className="no-scores">No sentences scored yet.</div>
                }
              </div>
            </div>
          </div>
        </>
      )}
      {/* Summary */}
      <div className="summary">
        <div className="summary-main">
          {percentage}% Correct ({correctCount} out of 25 words)
        </div>
        {currentForm !== 'P' && benefitStats.total > 0 && (
          <div className="summary-sub" style={{ fontSize: '0.8em', marginTop: '5px', color: '#666' }}>
            Benefit Score: {benefitStats.percentage}% (Sets 5,6,7)
          </div>
        )}
        {currentForm !== 'P' && strategyStats.total > 0 && (
          <div className="summary-sub" style={{ fontSize: '0.8em', marginTop: '2px', color: '#666' }}>
            Strategy Index: {strategyStats.percentage}% (Recency)
          </div>
        )}
      </div>

      {/* Performance Graph */}
      {allScored && (
        <div className="section">
          <div className="section-title">Performance by Block</div>
          <div className="graph-container">
            <div className="graph-y-axis">
              <div className="y-label">100%</div>
              <div className="y-label">75%</div>
              <div className="y-label">50%</div>
              <div className="y-label">25%</div>
              <div className="y-label">0%</div>
            </div>
            <div className="graph-content">
              {blockStats.map((stats, index) => (
                <div key={index} className="graph-bar-container">
                  <div className="graph-bar-wrapper">
                    <div
                      className="graph-bar"
                      style={{ height: `${stats.percentage}%` }}
                      title={`Block ${index + 1}: ${stats.correct}/${stats.total} = ${stats.percentage.toFixed(1)}%`}
                    >
                      <span className="bar-label">{stats.percentage.toFixed(0)}%</span>
                    </div>
                  </div>
                  <div className="graph-x-label">
                    {getBlockSizes(currentForm)[index]}<br />
                    <span className="x-label-small">sentences</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Metrics Table */}
          <div className="metrics-table" style={{ marginTop: '20px', padding: '0 20px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #eee' }}>
                  <th style={{ textAlign: 'left', padding: '8px' }}>Metric</th>
                  <th style={{ textAlign: 'center', padding: '8px', color: '#667eea' }}>Form A</th>
                  <th style={{ textAlign: 'center', padding: '8px', color: '#ff9f43' }}>Form B</th>
                  <th style={{ textAlign: 'center', padding: '8px', fontWeight: 'bold' }}>Net Difference</th>
                </tr>
              </thead>
              <tbody>
                {/* Helper to render a row */}
                {(() => {
                  // Total Score
                  const getPct = (f) => {
                    const s = scores[f];
                    const tot = Object.keys(s).length;
                    if (!tot) return null;
                    const corr = Object.values(s).filter(Boolean).length;
                    return (corr / tot * 100).toFixed(1);
                  };

                  const pctA = getPct('A');
                  const pctB = getPct('B');
                  const netPct = (pctA && pctB) ? Math.abs(parseFloat(pctB) - parseFloat(pctA)).toFixed(1) : '-';

                  // Benefit
                  const getBen = (f) => {
                    const b = getBenefitScore(f);
                    return b.total ? b.percentage : null; // return raw number/string
                  };

                  const benA = getBen('A');
                  const benB = getBen('B');
                  const netBen = (benA !== null && benB !== null) ? Math.abs(parseFloat(benB) - parseFloat(benA)).toFixed(1) : '-';



                  // Strategy
                  const getStrat = (f) => {
                    const s = getStrategyIndex(f);
                    return s.total ? s.percentage : null;
                  };

                  const stratA = getStrat('A');
                  const stratB = getStrat('B');
                  const netStrat = (stratA !== null && stratB !== null) ? Math.abs(parseFloat(stratB) - parseFloat(stratA)).toFixed(1) : '-';

                  const fmt = (val) => val !== null ? `${val}%` : '-';
                  const fmtNet = (val) => {
                    if (val === '-') return '-';
                    const n = parseFloat(val);
                    return `${n}%`;
                  };

                  return (
                    <>
                      <tr style={{ borderBottom: '1px solid #eee' }}>
                        <td style={{ padding: '8px', fontWeight: 'bold' }}>Total Score</td>
                        <td style={{ textAlign: 'center', padding: '8px' }}>{fmt(pctA)}</td>
                        <td style={{ textAlign: 'center', padding: '8px' }}>{fmt(pctB)}</td>
                        <td style={{ textAlign: 'center', padding: '8px', color: '#666' }}>{fmtNet(netPct)}</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #eee' }}>
                        <td style={{ padding: '8px' }}>
                          <div className="tooltip-container">
                            Benefit Score
                            <span className="info-icon">i</span>
                            <span className="tooltip-text">Measures Cognitive Spare Capacity. Shows the % of correct recall for the last 2 words of long lists (5-7 sentences). Higher scores indicate reduced listening effort.</span>
                          </div>
                        </td>
                        <td style={{ textAlign: 'center', padding: '8px' }}>{fmt(benA)}</td>
                        <td style={{ textAlign: 'center', padding: '8px' }}>{fmt(benB)}</td>
                        <td style={{ textAlign: 'center', padding: '8px', fontWeight: 'bold' }}>{fmtNet(netBen)}</td>
                      </tr>
                      <tr>
                        <td style={{ padding: '8px' }}>
                          <div className="tooltip-container">
                            Strategy Index
                            <span className="info-icon">i</span>
                            <span className="tooltip-text">Measures Cognitive Efficiency. Shows how often the patient started their recall with the last word heard. High scores (&gt;70%) suggest an efficient, low-effort strategy.</span>
                          </div>
                        </td>
                        <td style={{ textAlign: 'center', padding: '8px' }}>{fmt(stratA)}</td>
                        <td style={{ textAlign: 'center', padding: '8px' }}>{fmt(stratB)}</td>
                        <td style={{ textAlign: 'center', padding: '8px', color: '#666' }}>{fmtNet(netStrat)}</td>
                      </tr>
                    </>
                  );
                })()}
              </tbody>
            </table>
          </div>
          <div className="graph-x-title">Set Size</div>
        </div>
      )}




      {/* Live Results Comparison - Updates in Real-Time */}
      <div className="section">
        <div className="section-title">Live Results Comparison</div>
        <div className="results-comparison" style={{ display: 'block' }}>
          <div className="form-graph">
            <div className="form-graph-header">
              <h3>Combined Performance</h3>
              <div className="form-summary" style={{ fontSize: '16px', display: 'flex', gap: '20px', justifyContent: 'center' }}>
                <span style={{ color: '#667eea' }}>■ Form A</span>
                <span style={{ color: '#ff9f43' }}>■ Form B</span>
              </div>
            </div>
            <div className="graph-container">
              <div className="graph-y-axis-title">Performance</div>
              <div className="graph-y-axis">
                <div className="y-label">100%</div>
                <div className="y-label">75%</div>
                <div className="y-label">50%</div>
                <div className="y-label">25%</div>
                <div className="y-label">0%</div>
              </div>
              <div className="graph-content">
                {getBlockSizes('A').map((size, index) => {
                  const statsA = getFormBlockStats('A')[index];
                  const statsB = getFormBlockStats('B')[index];

                  const heightA = statsA.percentage || 0;
                  const heightB = statsB.percentage || 0;

                  return (
                    <div key={index} className="graph-bar-container">
                      <div className="graph-bar-wrapper" style={{ gap: '4px', alignItems: 'flex-end' }}>
                        {/* Bar A */}
                        <div
                          className="graph-bar"
                          style={{
                            height: `${heightA}%`,
                            minHeight: heightA > 0 ? '2px' : '0px',
                            background: 'linear-gradient(to top, #667eea, #764ba2)',
                            width: '40px'
                          }}
                          title={`Form A - Block ${index + 1}: ${statsA.correct}/${statsA.total} = ${statsA.percentage.toFixed(1)}%`}
                        >
                          <span className="bar-label" style={{ fontSize: '10px' }}>{statsA.total > 0 ? statsA.percentage.toFixed(0) : ''}</span>
                        </div>

                        {/* Bar B */}
                        <div
                          className="graph-bar"
                          style={{
                            height: `${heightB}%`,
                            minHeight: heightB > 0 ? '2px' : '0px',
                            background: 'linear-gradient(to top, #ff9f43, #ff6b6b)',
                            width: '40px'
                          }}
                          title={`Form B - Block ${index + 1}: ${statsB.correct}/${statsB.total} = ${statsB.percentage.toFixed(1)}%`}
                        >
                          <span className="bar-label" style={{ fontSize: '10px' }}>{statsB.total > 0 ? statsB.percentage.toFixed(0) : ''}</span>
                        </div>
                      </div>
                      <div className="graph-x-label">
                        {size}<br />
                        <span className="x-label-small">sentences</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="graph-x-title">Set Size</div>
          </div>
        </div>
      </div>




      {/* Database Management Section */}
      <div className="section">
        <div className="section-title">Results Database</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <strong>Stored Records: {testDatabase.length}</strong>
            <p style={{ fontSize: '0.85em', color: '#666', margin: '5px 0 0 0' }}>
              Tests are saved locally in your browser. Export to JSON to back them up.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={saveToDatabase}
              className="btn btn-success"
              title="Add current test results to the local database"
            >
              + Add Current Test
            </button>
            <div style={{ width: '1px', background: '#ccc', margin: '0 5px' }}></div>
            <button
              onClick={exportDatabase}
              className="btn btn-secondary"
            >
              Export DB
            </button>
            <button
              onClick={() => document.getElementById('importDbInput').click()}
              className="btn btn-secondary"
            >
              Import DB
            </button>
            <input
              type="file"
              id="importDbInput"
              accept=".json"
              style={{ display: 'none' }}
              onChange={importDatabase}
            />
            <button
              onClick={clearDatabase}
              className="btn btn-danger"
              style={{ marginLeft: '10px' }}
            >
              Clear DB
            </button>
          </div>
        </div>
      </div>
      {/* Bottom Buttons */}
      <div className="bottom-buttons">

        <button className="btn" onClick={exportResults}>
          Export Results
        </button>
        <button className="btn" onClick={generatePdf}>
          Print PDF
        </button>
      </div>
    </div>
  );
}

export default App;

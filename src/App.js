import React, { useState, useEffect, useRef } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import sentencesData from '../sentences.json';

// Access the preloaded API, with a fallback for running in a normal browser
const audioBaseUrl = window.electronAPI ? window.electronAPI.getAudioBaseUrl() : './audio_output';

const BLOCK_SIZES = [3, 4, 5, 6, 7];

function App() {
  const [patientName, setPatientName] = useState('');
  const [testDate, setTestDate] = useState(new Date().toISOString().slice(0, 10));
  const [currentForm, setCurrentForm] = useState('A');
  const [currentBlock, setCurrentBlock] = useState(0);
  const [scores, setScores] = useState({ A: {}, B: {} });
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentPlayingIndex, setCurrentPlayingIndex] = useState(null);
  const [showScoring, setShowScoring] = useState(false);
  const [isCalibrationPlaying, setIsCalibrationPlaying] = useState(false);
  const [noiseEnabled, setNoiseEnabled] = useState(false);
  const [snr, setSnr] = useState(15); // SNR in dB
  const [channelConfig, setChannelConfig] = useState('speech-left'); // 'speech-left' or 'speech-right'
  const [showResults, setShowResults] = useState(false);

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

  const formSentences = sentencesData.filter(s => s.list === currentForm);

  useEffect(() => {
    // Reset when form changes
    setCurrentBlock(0);
    setShowScoring(false);
  }, [currentForm]);

  const getBlockRange = (blockNum) => {
    const start = BLOCK_SIZES.slice(0, blockNum).reduce((a, b) => a + b, 0);
    const end = start + BLOCK_SIZES[blockNum];
    return { start, end };
  };

  const getCurrentBlockSentences = () => {
    const { start, end } = getBlockRange(currentBlock);
    return formSentences.slice(start, end);
  };

  const getBlockStats = (blockNum) => {
    const { start, end } = getBlockRange(blockNum);
    const blockSentences = formSentences.slice(start, end);
    const formScores = scores[currentForm];

    let correct = 0;
    let total = 0;

    blockSentences.forEach(sentence => {
      if (formScores[sentence.id] !== undefined) {
        total++;
        if (formScores[sentence.id]) correct++;
      }
    });

    return { correct, total, percentage: total > 0 ? (correct / total * 100) : 0 };
  };

  const getFormBlockStats = (formName) => {
    const formSents = sentencesData.filter(s => s.list === formName);

    // Safety check
    if (!formSents || formSents.length === 0) {
      return BLOCK_SIZES.map(() => ({ correct: 0, total: 0, percentage: 0 }));
    }

    const formScores = scores[formName] || {};

    return BLOCK_SIZES.map((size, blockNum) => {
      const { start, end } = getBlockRange(blockNum);
      const blockSentences = formSents.slice(start, end);

      let correct = 0;
      let total = 0;

      blockSentences.forEach(sentence => {
        if (sentence && formScores[sentence.id] !== undefined) {
          total++;
          if (formScores[sentence.id]) correct++;
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

  const playCalibrationChannel = (panValue, channelName) => {
    return new Promise((resolve, reject) => {
      const audio = new Audio(`${audioBaseUrl}/calibration_1khz_neg20db.wav`);
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
    if (currentBlock < BLOCK_SIZES.length - 1) {
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

  const scoreSentence = (sentenceId, correct) => {
    setScores(prev => ({
      ...prev,
      [currentForm]: {
        ...prev[currentForm],
        [sentenceId]: correct
      }
    }));
  };

  const resetForm = () => {
    if (window.confirm(`Are you sure you want to reset all scores for Form ${currentForm}?`)) {
      setScores(prev => ({
        ...prev,
        [currentForm]: {}
      }));
      setCurrentBlock(0);
      setShowScoring(false);
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
    content += `Form: ${currentForm}\n`;
    content += '='.repeat(80) + '\n\n';

    let correctCount = 0;
    let scoredCount = 0;

    formSentences.forEach(sentence => {
      const score = scores[currentForm][sentence.id];
      const result = score === undefined ? 'NOT SCORED' : (score ? 'CORRECT' : 'INCORRECT');

      if (score !== undefined) {
        scoredCount++;
        if (score) correctCount++;
      }

      content += `ID: ${sentence.id}\n`;
      content += `Sentence: ${sentence.text}\n`;
      content += `Target: ${sentence.target}\n`;
      content += `Result: ${result}\n`;
      content += '-'.repeat(80) + '\n';
    });

    content += '\nSUMMARY\n';
    content += '='.repeat(80) + '\n';
    if (scoredCount > 0) {
      const percentage = (correctCount / scoredCount * 100).toFixed(1);
      content += `Scored: ${scoredCount}/${formSentences.length} sentences\n`;
      content += `Correct: ${correctCount}/${scoredCount} = ${percentage}%\n`;
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
    doc.text(`Form: ${currentForm}`, 14, 50);

    // Draw Graph instead of Table

    const startX = 20;
    const startY = 70;
    const graphWidth = 160;
    const graphHeight = 100;
    const maxVal = 100;

    // Draw Title
    doc.setFontSize(14);
    doc.text(`Performance Comparison (Combined)`, 14, 60);

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
    const statsA = getFormBlockStats('A');
    const statsB = getFormBlockStats('B');

    BLOCK_SIZES.forEach((size, i) => {
      // Calculate position
      const sectionWidth = graphWidth / BLOCK_SIZES.length;
      const groupCenterX = startX + (sectionWidth * i) + (sectionWidth / 2);

      const xA = groupCenterX - barWidth - 1; // Shift left
      const xB = groupCenterX + 1; // Shift right

      // Draw Bar A
      const sA = statsA[i];
      const hA = (sA.percentage / 100) * graphHeight;
      const yA = startY + graphHeight - hA;

      doc.setFillColor(102, 126, 234); // Purple
      if (sA.percentage > 0) {
        doc.rect(xA, yA, barWidth, hA, 'F');
      }

      // Draw Bar B
      const sB = statsB[i];
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
  const blockSize = BLOCK_SIZES[currentBlock];
  const targets = blockSentences.map(s => s.target).join(', ');

  // Calculate summary stats
  const formScores = scores[currentForm];
  const scoredCount = Object.keys(formScores).length;
  const correctCount = Object.values(formScores).filter(Boolean).length;
  const percentage = scoredCount > 0 ? (correctCount / scoredCount * 100).toFixed(1) : 0;

  // Calculate block statistics for graph
  const blockStats = BLOCK_SIZES.map((size, index) => getBlockStats(index));
  const allScored = scoredCount === 25;

  return (
    <div className="app">
      <h1>Speech Audiometry Scoring System</h1>

      {/* Patient Info Section */}
      <div className="section">
        <div className="section-title">Patient Information</div>
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
        </div>
      </div>

      {/* Form Selection */}
      <div className="section">
        <div className="section-title">Form Selection</div>
        <div className="form-selection">
          <label>
            <input
              type="radio"
              value="A"
              checked={currentForm === 'A'}
              onChange={(e) => setCurrentForm(e.target.value)}
            />
            Form A
          </label>
          <label>
            <input
              type="radio"
              value="B"
              checked={currentForm === 'B'}
              onChange={(e) => setCurrentForm(e.target.value)}
            />
            Form B
          </label>
          <div className="separator"></div>
          {!isCalibrationPlaying ? (
            <div className="calibration-buttons">
              <button className="btn btn-secondary" onClick={playCalibrationLeft}>
                🔊 Left Channel
              </button>
              <button className="btn btn-secondary" onClick={playCalibration}>
                🔊 Both Channels
              </button>
              <button className="btn btn-secondary" onClick={playCalibrationRight}>
                🔊 Right Channel
              </button>
            </div>
          ) : (
            <button className="btn btn-danger" onClick={stopCalibration}>
              ⏸ Stop Calibration
            </button>
          )}
        </div>
      </div>

      {/* Current Block Info */}
      <div className="section">
        <div className="section-title">Current Block</div>
        <div className="block-info">
          <h3>Block {currentBlock + 1}/5 ({blockSize} sentences)</h3>
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
                  min="-10"
                  max="20"
                  step="1"
                  value={snr}
                  onChange={(e) => setSnr(parseInt(e.target.value))}
                  disabled={isPlaying}
                  className="snr-slider"
                />
                <div className="snr-range-labels">
                  <span>-10 dB</span>
                  <span>0 dB</span>
                  <span>+20 dB</span>
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
                {blockSentences.map(sentence => {
                  const score = scores[currentForm][sentence.id];
                  return (
                    <div key={sentence.id} className="scoring-row">
                      <div className="scoring-row-label">
                        ID {sentence.id}: {sentence.target}
                      </div>
                      <button
                        className="btn btn-success"
                        onClick={() => scoreSentence(sentence.id, true)}
                      >
                        ✓
                      </button>
                      <button
                        className="btn btn-danger"
                        onClick={() => scoreSentence(sentence.id, false)}
                      >
                        ✗
                      </button>
                      <div className={`score-status ${score === true ? 'correct' : score === false ? 'incorrect' : ''}`}>
                        {score === undefined ? 'Not scored' : score ? '✓ Correct' : '✗ Incorrect'}
                      </div>
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

      {/* Summary */}
      <div className="summary">
        <div className="summary-main">
          {percentage}% Correct ({correctCount} out of 25 words)
        </div>
      </div>

      {/* Performance Graph */}
      {allScored && !showResults && (
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
                    {BLOCK_SIZES[index]}<br />
                    <span className="x-label-small">sentences</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="graph-x-title">Set Size</div>
        </div>
      )}

      {/* Live Results Comparison - Updates in Real-Time */}
      {!showResults && (
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
                  {BLOCK_SIZES.map((size, index) => {
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
      )}

      {/* Results Comparison View */}
      {showResults && (
        <div className="section">
          <div className="section-title">Results Comparison</div>
          <div className="results-comparison">
            {['A', 'B'].map(form => {
              const formBlockStats = getFormBlockStats(form);
              const formScores = scores[form];
              const formScoredCount = Object.keys(formScores).length;
              const formCorrectCount = Object.values(formScores).filter(v => v === true).length;
              const formPercentage = formScoredCount > 0 ? (formCorrectCount / formScoredCount * 100).toFixed(1) : 0;

              return (
                <div key={form} className="form-graph">
                  <div className="form-graph-header">
                    <h3>Form {form}</h3>
                    <div className="form-summary">
                      {formPercentage}% ({formCorrectCount} out of {formScoredCount})
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
                      {formBlockStats.map((stats, index) => (
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
                            {BLOCK_SIZES[index]}<br />
                            <span className="x-label-small">sentences</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="graph-x-title">Set Size</div>
                </div>
              );
            })}
          </div>
          <button className="btn" onClick={() => setShowResults(false)}>
            ← Back to Scoring
          </button>
        </div>
      )}

      {/* Bottom Buttons */}
      <div className="bottom-buttons">
        <button className="btn" onClick={() => setShowResults(!showResults)}>
          {showResults ? '← Back to Scoring' : '📊 Fullscreen Results'}
        </button>
        <button className="btn btn-secondary" onClick={resetForm}>
          Reset Form
        </button>
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

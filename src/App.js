import React, { useState, useEffect, useRef } from 'react';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import sentencesData from '../sentences.json';

const { remote } = window.require ? window.require('electron') : {};
const audioPath = remote ? remote.getGlobal('audioPath') : 'audio_output';

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
  const [snr, setSnr] = useState(5); // SNR in dB
  const [channelConfig, setChannelConfig] = useState('speech-left'); // 'speech-left' or 'speech-right'
  const [showResults, setShowResults] = useState(false);
  
  const audioRef = useRef(null);
  const audioContextRef = useRef(null);
  const speechPannerRef = useRef(null);
  const noisePannerRef = useRef(null);
  const calibrationRef = useRef(null);
  const noiseRef = useRef(null);
  const blockSentencesRef = useRef([]);

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

  // Handle continuous background noise
  useEffect(() => {
    if (noiseEnabled && audioContextRef.current && noisePannerRef.current) {
      // Resume audio context if suspended
      if (audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume();
      }
      
      // Start continuous noise
      const noise = new Audio(`${audioPath}/babble_noise.wav`);
      noise.loop = true;
      noise.crossOrigin = 'anonymous';
      
      const source = audioContextRef.current.createMediaElementSource(noise);
      const gainNode = audioContextRef.current.createGain();
      
      // Calculate noise volume based on SNR (in dB)
      const noiseVolume = Math.pow(10, -snr / 20);
      gainNode.gain.value = Math.min(1.0, Math.max(0, noiseVolume));
      
      source.connect(gainNode);
      gainNode.connect(noisePannerRef.current);
      
      noiseRef.current = { audio: noise, source, gainNode };
      noise.play().catch(err => console.warn('Noise playback failed:', err));
    } else {
      // Stop noise when disabled
      if (noiseRef.current) {
        noiseRef.current.audio.pause();
        noiseRef.current.audio.currentTime = 0;
        noiseRef.current = null;
      }
    }

    // Cleanup on unmount or when dependencies change
    return () => {
      if (noiseRef.current) {
        noiseRef.current.audio.pause();
        noiseRef.current.audio.currentTime = 0;
        noiseRef.current = null;
      }
    };
  }, [noiseEnabled, snr]);

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
      const audio = new Audio(`${audioPath}/calibration_1khz_neg20db.wav`);
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
    setShowScoring(false);

    for (let i = 0; i < blockSentences.length; i++) {
      const sentence = blockSentences[i];
      setCurrentPlayingIndex(i);
      
      const audioFilePath = `${audioPath}/Form ${currentForm}/wav/swir_${sentence.id}.wav`;
      
      try {
        await playAudioFile(audioFilePath);
        // 3-second interstimulus interval
        await new Promise(resolve => setTimeout(resolve, 3000));
      } catch (err) {
        alert(`Error playing audio: ${err.message}`);
        setIsPlaying(false);
        setCurrentPlayingIndex(null);
        return;
      }
    }

    setIsPlaying(false);
    setCurrentPlayingIndex(null);
    setShowScoring(true);
  };

  const playAudioFile = (path) => {
    return new Promise((resolve, reject) => {
      if (!audioContextRef.current || !speechPannerRef.current) {
        reject(new Error('Audio context not initialized'));
        return;
      }
      
      // Resume audio context if suspended
      if (audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume();
      }
      
      const audio = new Audio(path);
      audio.crossOrigin = 'anonymous';
      
      const source = audioContextRef.current.createMediaElementSource(audio);
      source.connect(speechPannerRef.current);
      
      audioRef.current = { audio, source };
      
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error('Audio file not found or cannot be played'));
      
      audio.play().catch(reject);
    });
  };

  const stopAudio = () => {
    if (audioRef.current && audioRef.current.audio) {
      audioRef.current.audio.pause();
      audioRef.current.audio.currentTime = 0;
    }
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
    const doc = new jsPDF();
    const tableData = formSentences.map(s => {
      const score = scores[currentForm][s.id];
      const scoreMark = score === undefined ? '-' : score ? '✓' : '✗';
      return [s.id, s.text, s.target, scoreMark];
    });

    doc.autoTable({
      head: [['ID', 'Sentence', 'Target Word', 'Score']],
      body: tableData,
      startY: 50,
    });

    doc.text('Speech Audiometry Results', 14, 20);
    doc.text(`Patient Name: ${patientName}`, 14, 30);
    doc.text(`Test Date: ${testDate}`, 14, 40);

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
                    {BLOCK_SIZES[index]}<br/>
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
          <div className="results-comparison">
            {['A', 'B'].map(form => {
              const formBlockStats = getFormBlockStats(form);
              const formScores = scores[form] || {};
              const formScoredCount = Object.keys(formScores).length;
              const formCorrectCount = Object.values(formScores).filter(v => v === true).length;
              const formPercentage = formScoredCount > 0 ? (formCorrectCount / formScoredCount * 100).toFixed(1) : 0;
              
              return (
                <div key={form} className="form-graph">
                  <div className="form-graph-header">
                    <h3>Form {form}</h3>
                    <div className="form-summary">
                      {formPercentage}% ({formCorrectCount} out of {formScoredCount} scored)
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
                      {formBlockStats.map((stats, index) => {
                        const barHeight = stats.percentage || 0;
                        return (
                          <div key={`${form}-block-${index}-${stats.correct}-${stats.total}`} className="graph-bar-container">
                            <div className="graph-bar-wrapper">
                              <div 
                                className="graph-bar" 
                                style={{ 
                                  height: `${barHeight}%`,
                                  minHeight: barHeight > 0 ? '2px' : '0px'
                                }}
                                title={`Block ${index + 1}: ${stats.correct}/${stats.total} = ${stats.percentage.toFixed(1)}%`}
                              >
                                <span className="bar-label">{stats.total > 0 ? stats.percentage.toFixed(0) + '%' : ''}</span>
                              </div>
                            </div>
                            <div className="graph-x-label">
                              {BLOCK_SIZES[index]}<br/>
                              <span className="x-label-small">sentences</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="graph-x-title">Set Size</div>
                </div>
              );
            })}
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
                            {BLOCK_SIZES[index]}<br/>
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

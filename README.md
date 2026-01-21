# Speech Audiometry Scoring Application

A cross-platform desktop application for speech audiometry testing and scoring, built with React and Electron.

## Features

- **Block-based Testing**: Sentences organized in blocks of 3, 4, 5, 6, and 7 sentences
- **Two Forms**: Separate scoring for Form A (sentences 1-25) and Form B (sentences 26-50)
- **Sequential Playback**: Automatic playback of all sentences in a block
- **Target Word Scoring**: Score each target word as correct or incorrect after block playback
- **Calibration Tone**: Built-in calibration tone for sound level meter setup
- **Results Export**: Export detailed results to text files
- **Cross-Platform**: Runs on Windows, macOS, and Linux

## Installation

1. Install dependencies:
```bash
npm install
```

## Usage

### Development Mode

Run the application in development mode with hot reloading:

```bash
npm run dev
```

This will:
- Start the webpack dev server on port 3000
- Launch the Electron app with developer tools
- Enable hot module reloading for React components

### Production Build

Build the application for production:

```bash
npm run build
```

Package the application for your platform:

```bash
npm run package
```

This will create a distributable package in the `dist` folder.

## Project Structure

```
swir_project/
├── electron/
│   └── main.js              # Electron main process
├── src/
│   ├── App.js               # Main React component
│   ├── index.js             # React entry point
│   ├── index.html           # HTML template
│   └── styles.css           # Application styles
├── audio_output/
│   ├── calibration.wav      # Calibration tone
│   ├── Form A/
│   │   └── wav/             # Form A audio files (01.wav - 25.wav)
│   └── Form B/
│       └── wav/             # Form B audio files (26.wav - 50.wav)
├── sentences.json           # Sentence data
├── package.json             # Project dependencies and scripts
└── webpack.config.js        # Webpack configuration
```

## How to Use the Application

1. **Select Form**: Choose Form A or Form B using the radio buttons

2. **Calibrate** (optional): Click "Play Calibration Tone" to calibrate your sound level meter

3. **Play Block**: Click "Play Block" to play all sentences in the current block sequentially

4. **Score Responses**: After the block finishes playing, score each target word:
   - Click ✓ if the target word was heard correctly
   - Click ✗ if the target word was heard incorrectly

5. **Navigate Blocks**: Use "Next Block" and "Previous Block" to move through all 5 blocks

6. **View Results**: Results are displayed in real-time showing:
   - Individual sentence scores
   - Total correct/scored
   - Percentage correct

7. **Export**: Click "Export Results" to save detailed results to a text file

8. **Reset**: Click "Reset Form" to clear all scores and start over

## Block Structure

Each form contains 25 sentences divided into 5 blocks:
- Block 1: 3 sentences
- Block 2: 4 sentences
- Block 3: 5 sentences
- Block 4: 6 sentences
- Block 5: 7 sentences

## Audio File Requirements

- Audio files must be in WAV format
- Files should be named with their sentence ID (e.g., `01.wav`, `02.wav`)
- Form A files: IDs 01-25 in `audio_output/Form A/wav/`
- Form B files: IDs 26-50 in `audio_output/Form B/wav/`
- Calibration tone: `audio_output/calibration.wav`

## Technology Stack

- **React 18**: UI framework
- **Electron 27**: Desktop application framework
- **Webpack 5**: Module bundler
- **Babel**: JavaScript transpiler
- **HTML5 Audio API**: Audio playback

## Troubleshooting

### Audio files not playing
- Verify audio files exist in the correct directories
- Check file naming matches sentence IDs
- Ensure files are in WAV format

### Application won't start
- Run `npm install` to ensure all dependencies are installed
- Check that Node.js version is 16 or higher
- Try deleting `node_modules` and running `npm install` again

### Development mode not hot-reloading
- Ensure webpack dev server is running on port 3000
- Check that no other application is using port 3000
- Restart the development server

## Building for Distribution

To create installers for different platforms:

```bash
# Windows
npm run package

# The output will be in the dist folder
```

Configure additional build options in the `build` section of `package.json`.

## License

MIT

# AVIF Convertor (VS Code Extension)

Right-click **files** or **folders** in VS Code Explorer to convert `png/jpg/jpeg/gif/apng` to `avif` (powered by `avifenc`).

## Features

- Right-click a **file**: Convert to `.avif` with the same name
- Right-click a **folder**: Batch convert all images (recursive by default)
- Output path options:
  - Default: Output to the same directory as the source file
  - Set `avifConvert.outDir`: Output to a specified directory (preserves relative paths for folder conversion)
- Auto-install on macOS (optional): Prompts to run `brew install libavif` when `avifenc` is not found

## Installation / Development

1. Install dependencies

```bash
npm install
```

2. Compile

```bash
npm run compile
```

3. Press `F5` in VS Code to launch the **Extension Development Host**, then right-click images/folders in the Explorer to test.

## Configuration

Search for `AVIF Convertor` or `avifConvert` in VS Code Settings:

| Setting | Description | Default |
|---------|-------------|---------|
| `avifConvert.crf` | Quality value (0-63). Lower is higher quality. | `20` |
| `avifConvert.speed` | Encoding speed (0-10). Higher is faster but lower quality. | `6` |
| `avifConvert.lossless` | Enable lossless compression. | `false` |
| `avifConvert.recursive` | Recurse into subdirectories when converting a folder. | `true` |
| `avifConvert.outDir` | Output directory. Empty means same directory as source. | `""` |
| `avifConvert.overwrite` | Overwrite existing `.avif` files. | `false` |
| `avifConvert.jobs` | Number of jobs passed to `avifenc` (`-j/--jobs`). 0 means not passed. | `0` |
| `avifConvert.autoInstallOnMac` | Prompt to install `avifenc` via Homebrew on macOS when missing. | `true` |

## Requirements

Requires `avifenc` (libavif) to be installed on your system.

**macOS:**

```bash
brew install libavif
```

**Ubuntu/Debian:**

```bash
sudo apt install libavif-bin
```

**Windows:**

Download from [libavif releases](https://github.com/AOMediaCodec/libavif/releases) or use a package manager like Chocolatey.

## License

MIT


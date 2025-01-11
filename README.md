A Node.js utility for exporting linked notes and attachments from an Obsidian vault. This script resolves and copies notes, images, and other attachments to a specified output directory, preserving file relationships while minimizing duplication.

## Features

- Resolves and processes Markdown links and Wikilinks for both relative and absolute paths.
- Copies attachments (e.g., images, PDFs, Excalidraw files) to a centralized `attachments` folder.
- Exports linked notes to a `references` folder, flattening the directory structure.
- Handles file collisions by generating unique filenames using content-based hashes.
- Processes standard Markdown links alongside Wikilinks.
- Handles Excalidraw embeds by replacing them with corresponding PNGs.
- Detects and skips duplicate files based on content hashes.
- Correctly handles URLs and ensures they are not treated as files to copy.
- Optionally excludes empty `references` folders if no linked notes are found.
- (Planned) Exports linked notes to their original subfolders when applicable.

## Usage

### Prerequisites

- Node.js (v16 or later)
- An existing Obsidian vault
- Global attachments directory within vault (can also work without this but not tested)

### Setup

1. Clone this repository.
2. Update the `VAULT_DIR` constant in `obsidian-exporter.js` to point to your Obsidian vault.

### Run the Script

```bash
node obsidian-exporter.js <input-markdown-file/folder> <output-directory>
```

### Example

For exporting a single file::

```bash
node obsidian-exporter.js "/Users/avcton/Vault/Note.md" "/Users/avcton/Exported"
```

For exporting an entire folder:

```bash
node obsidian-exporter.js "/Users/avcton/Vault/Projects" "/Users/avcton/Exported"
```

## How It Works

1. Parses the specified Markdown file for links to other notes and attachments.
2. Resolves paths using Obsidian's link resolution logic.
3. Copies linked files to the output directory, organizing attachments and notes.
4. Ensures unique filenames for conflicting files by appending SHA-256 hashes to filenames.

## Logging

- Warnings are logged for missing files or issues during file resolution.
- Successfully copied files and skipped duplicates are also logged.

## Archival Notice

This script served its purpose for a significant time. However, the community plugin [Enveloppe](https://github.com/Enveloppe/obsidian-enveloppe) has since emerged as a superior alternative, providing similar but more advanced functionality. While I now use [Enveloppe](https://github.com/Enveloppe/obsidian-enveloppe), I may revisit this script if the plugin becomes unavailable or encounters issues.

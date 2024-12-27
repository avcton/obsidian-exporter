import path from "path"
import fs from "fs/promises"

// Constants
const VAULT_DIR = "/Users/avcton/Mind Palace"
const ATTACHMENTS_DIR = path.join(VAULT_DIR, "_attachments")
const EXCALIDRAW_REPLACEMENT = ".dark.png"

// Helper function to log warnings
const logWarning = (message) => {
  console.warn(`[WARNING]: ${message}`)
}

// Helper function to copy files to the output directory
const copyFileToOutput = async (sourcePath, destinationPath) => {
  try {
    await fs.access(sourcePath, fs.constants.R_OK)
    await fs.mkdir(path.dirname(destinationPath), { recursive: true })
    await fs.copyFile(sourcePath, destinationPath)
  } catch (error) {
    if (error.code === "ENOENT") {
      logWarning(`Source file not found: ${sourcePath}`)
    } else {
      throw error // Re-throw other errors
    }
  }
}

// Parse markdown file for Wikilinks and Markdown links
const parseMarkdownForLinks = async (filePath) => {
  const content = await fs.readFile(filePath, "utf8")
  const attachmentLinks = []
  const noteLinks = []

  // Helper function to process links
  const processLink = (link) => {
    const decodedLink = decodeURIComponent(link)
    const cleanLink = decodedLink.split("#")[0] // Remove heading if present
    const extension = path.extname(cleanLink)

    if (extension && extension !== ".md") {
      // If there's a non-markdown extension, it's an attachment
      // Special case for Excalidraw files
      if (cleanLink.endsWith(".excalidraw")) {
        attachmentLinks.push(cleanLink + EXCALIDRAW_REPLACEMENT)
      } else {
        attachmentLinks.push(cleanLink)
      }
    } else {
      // If there's no extension or it's .md, it's a note
      // Ensure .md extension is added if not present
      const noteLink = extension ? cleanLink : `${cleanLink}.md`
      noteLinks.push(noteLink)
    }
  }

  // Match Wikilinks [[...]] without URL Schemes, both for attachments and notes
  const wikilinkRegex = /\[\[(?![a-zA-Z][a-zA-Z\d+\-.]*:\/\/)(.+?)(?:\|.+?)?\]\]/g
  let match
  while ((match = wikilinkRegex.exec(content)) !== null) {
    processLink(match[1])
  }

  // Match without URL Schemes Markdown links, both for attachments and notes
  const markdownLinkRegex = /\[(.*?)\]\((?![a-zA-Z][a-zA-Z\d+\-.]*:\/\/)(.*?)\)/g
  while ((match = markdownLinkRegex.exec(content)) !== null) {
    processLink(match[2])
  }

  return { attachments: attachmentLinks, notes: noteLinks }
}

// Resolve file path based on Obsidian's "Shortest" link resolution
const resolveFilePath = async (basePath, link) => {
  // Case 1: Just filename (unique case)
  if (link.includes("/") === false) {
    // First, check in ATTACHMENTS_DIR
    let resolvedPath = path.join(ATTACHMENTS_DIR, link)
    try {
      await fs.access(resolvedPath)
      return resolvedPath
    } catch {
      // If not found in ATTACHMENTS_DIR, search in the entire vault
      return findFileInVault(VAULT_DIR, link)
    }
  }

  // Case 2: Relative path
  if (link.startsWith("../") || link.startsWith("./")) {
    return path.resolve(path.dirname(basePath), link)
  }

  // Case 3: Absolute path
  return path.join(VAULT_DIR, link)
}

// Resolve and copy attachments to a centralized output folder (references/attachments)
const resolveAndCopyAttachments = async (
  attachments,
  basePath,
  outputDir,
  uniqueAttachments,
  isReference = false,
) => {
  for (const attachment of attachments) {
    let resolvedPath = await resolveFilePath(basePath, attachment)
    let attachmentOutputDir = isReference
      ? path.join(outputDir, "references", "attachments")
      : path.join(outputDir, "attachments")

    if (!resolvedPath) {
      logWarning(`Attachment not found: ${attachment}`)
      continue
    }

    const destinationPath = path.join(attachmentOutputDir, path.basename(resolvedPath))

    // Check for duplicates before copying
    if (!uniqueAttachments.has(destinationPath)) {
      await copyFileToOutput(resolvedPath, destinationPath)
      uniqueAttachments.add(destinationPath)
    }
  }
}

// Resolve and copy linked notes to references folder (flat structure)
const resolveAndCopyNotes = async (
  notes,
  basePath,
  outputDir,
  uniqueNotes,
  visitedNotes,
  inputFolder,
) => {
  const referenceDir = path.join(outputDir, "references")

  for (const note of notes) {
    if (visitedNotes.has(note)) {
      continue // Skip already visited notes to avoid infinite recursion
    }

    visitedNotes.add(note)

    let resolvedPath = await resolveFilePath(basePath, note)
    if (!resolvedPath) {
      logWarning(`Note not found: ${note}`)
      continue
    }

    // If the note is outside the input folder, copy it to the references folder
    if (!resolvedPath.startsWith(inputFolder)) {
      const destinationPath = path.join(referenceDir, path.basename(resolvedPath))

      // Check for duplicates before copying
      if (!uniqueNotes.has(destinationPath)) {
        await copyFileToOutput(resolvedPath, destinationPath)
        uniqueNotes.add(destinationPath)

        // Process the attachments for this note
        const { attachments } = await parseMarkdownForLinks(resolvedPath)
        const uniqueAttachments = new Set()
        await resolveAndCopyAttachments(
          attachments,
          resolvedPath,
          outputDir,
          uniqueAttachments,
          true,
        )

        // Recursively resolve and copy nested linked notes
        const { notes: nestedNotes } = await parseMarkdownForLinks(resolvedPath)
        await resolveAndCopyNotes(
          nestedNotes,
          resolvedPath,
          outputDir,
          uniqueNotes,
          visitedNotes,
          inputFolder,
        )
      }
    }
  }
}

// Find file in the vault recursively
const findFileInVault = async (vaultDir, fileName) => {
  const files = await fs.readdir(vaultDir, { withFileTypes: true })

  for (const file of files) {
    const filePath = path.join(vaultDir, file.name)
    if (file.isDirectory()) {
      const result = await findFileInVault(filePath, fileName)
      if (result) return result
    } else if (file.name === fileName) {
      return filePath
    }
  }

  return null
}

// Process a single markdown file (No recursion for linked notes)
const processMarkdownFile = async (filePath, outputDir, visitedNotes, inputFolder) => {
  const destinationPath = path.join(outputDir, path.basename(filePath))

  await copyFileToOutput(filePath, destinationPath)

  const { attachments, notes } = await parseMarkdownForLinks(filePath)

  // Resolve and copy attachments for the target note (stored in output/attachments)
  const uniqueAttachments = new Set()
  await resolveAndCopyAttachments(attachments, filePath, outputDir, uniqueAttachments)

  // Resolve and copy linked notes (stored in output/references)
  const uniqueNotes = new Set()
  await resolveAndCopyNotes(notes, filePath, outputDir, uniqueNotes, visitedNotes, inputFolder)
}

// Main function to handle user input
const main = async () => {
  const inputPath = process.argv[2]

  if (!inputPath) {
    console.error("Usage: node script.js <inputPath>")
    process.exit(1)
  }

  const fullPath = path.join(VAULT_DIR, inputPath)
  const stats = await fs.stat(fullPath)

  // Determine the output directory name dynamically based on input file/folder
  const outputDir = path.join(process.cwd(), path.basename(fullPath).replace(/\.md$/, ""))

  try {
    if (stats.isDirectory()) {
      const files = await fs.readdir(fullPath)
      for (const file of files) {
        if (file.endsWith(".md")) {
          const visitedNotes = new Set()
          await processMarkdownFile(path.join(fullPath, file), outputDir, visitedNotes, fullPath)
        }
      }
    } else if (stats.isFile() && fullPath.endsWith(".md")) {
      const visitedNotes = new Set()
      await processMarkdownFile(fullPath, outputDir, visitedNotes, path.dirname(fullPath))
    }
  } catch (err) {
    console.error(`Error: ${err.message}`)
  }
}

main().catch((err) => console.error(err))

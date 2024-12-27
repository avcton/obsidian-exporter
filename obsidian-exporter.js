import path from "path"
import fs from "fs/promises"
import { createHash } from "crypto"

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

const generateUniqueName = async (filePath) => {
  try {
    const fileContent = await fs.readFile(filePath)
    const hash = createHash("sha256").update(fileContent).digest("hex").substring(0, 8)
    const parsedPath = path.parse(filePath)
    return `${parsedPath.name}_${hash}${parsedPath.ext}`
  } catch (error) {
    console.error(`Error generating unique name for ${filePath}:`, error)
    process.exit(1) // Exit the script on error
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

// Resolve and copy attachments to a single global attachments folder
const resolveAndCopyAttachments = async (
  attachments,
  basePath,
  outputDir,
  uniqueAttachments,
  renamedFiles,
) => {
  const globalAttachmentsDir = path.join(outputDir, "attachments")

  try {
    await fs.access(globalAttachmentsDir)
  } catch {
    await fs.mkdir(globalAttachmentsDir)
  }

  for (const attachment of attachments) {
    let resolvedPath = await resolveFilePath(basePath, attachment)

    if (!resolvedPath) {
      logWarning(`Attachment not found: ${attachment}`)
      continue
    }

    const resolvedName = path.basename(resolvedPath)
    let uniqueName = resolvedName
    let collisionDetected = false

    // Check if an attachment with the same *content* already exists
    let existingAttachmentPath = null
    for (const [existingPath, attachment] of uniqueAttachments) {
      if (path.basename(existingPath) === resolvedName) {
        try {
          const existingFileStats = await fs.stat(existingPath)
          const currentFileStats = await fs.stat(resolvedPath)

          if (existingFileStats.size === currentFileStats.size) {
            const existingFileContent = await fs.readFile(existingPath)
            const currentFileContent = await fs.readFile(resolvedPath)
            if (existingFileContent.equals(currentFileContent)) {
              existingAttachmentPath = existingPath
              uniqueName = path.basename(existingPath)
              break // Found a match, no need to check further
            }
          }
        } catch (err) {
          console.error(`Error comparing files: ${err}`)
        }
      }
    }

    if (existingAttachmentPath) {
      console.log(`Attachment already exists (same content): ${attachment}`)
      continue // Skip copying
    }

    // Handle name collisions (different content, same name)
    for (const [existingPath, attachment] of uniqueAttachments) {
      if (path.basename(existingPath) === resolvedName) {
        collisionDetected = true

        // Rename the existing file
        const newExistingName = await generateUniqueName(existingPath)
        const newExistingPath = path.join(globalAttachmentsDir, newExistingName)
        await fs.rename(
          path.join(globalAttachmentsDir, path.basename(existingPath)),
          newExistingPath,
        )
        uniqueAttachments.delete(existingPath)
        uniqueAttachments.set(newExistingPath, attachment)
        renamedFiles[attachment] = newExistingName
        break
      }
    }

    const existingCheckRegex = new RegExp(
      `^${path.parse(resolvedName).name}(_[a-zA-Z0-9]+)?\\.[a-zA-Z0-9]+$`,
    )
    collisionDetected = Array.from(uniqueAttachments).some(([existingPath]) =>
      existingCheckRegex.test(path.basename(existingPath)),
    )

    // Generate unique name for the *current* file if a collision was detected
    if (collisionDetected) {
      uniqueName = await generateUniqueName(resolvedPath)
      renamedFiles[attachment] = uniqueName // Only add to renamedFiles if renamed
    }

    const destinationPath = path.join(globalAttachmentsDir, uniqueName)
    await copyFileToOutput(resolvedPath, destinationPath)
    uniqueAttachments.set(destinationPath, attachment)
  }
}

// Resolve and copy linked notes to references folder (preserving hierarchy but no subfolders)
const resolveAndCopyNotes = async (
  notes,
  basePath,
  outputDir,
  uniqueAttachments,
  uniqueNotes,
  visitedNotes,
  renamedFiles,
) => {
  const referencesFolder = path.join(outputDir, "references")

  try {
    await fs.access(referencesFolder)
  } catch {
    await fs.mkdir(referencesFolder)
  }

  for (const note of notes) {
    if (visitedNotes.has(note)) {
      continue
    }

    visitedNotes.add(note)

    let resolvedPath = await resolveFilePath(basePath, note)
    if (!resolvedPath) {
      logWarning(`Note not found: ${note}`)
      continue
    }

    const resolvedName = path.basename(resolvedPath)

    // Check if the file is already in the output directory (root level)
    const relativePathFromOutput = path.relative(outputDir, path.parse(resolvedName).name)
    if (!relativePathFromOutput.startsWith("..") && !path.isAbsolute(relativePathFromOutput)) {
      // Note already in output directory
      uniqueNotes.set(resolvedPath, note)
      continue
    }

    let finalPath = path.join(referencesFolder, resolvedName)
    let uniqueName = resolvedName
    let collisionDetected = false

    // Check if a note with the same *content* already exists
    let existingNotePath = null
    for (const [existingPath, note] of uniqueNotes) {
      if (path.basename(existingPath) === resolvedName) {
        try {
          const existingFileStats = await fs.stat(existingPath)
          const currentFileStats = await fs.stat(resolvedPath)

          if (existingFileStats.size === currentFileStats.size) {
            const existingFileContent = await fs.readFile(existingPath)
            const currentFileContent = await fs.readFile(resolvedPath)
            if (existingFileContent.equals(currentFileContent)) {
              existingNotePath = existingPath
              uniqueName = path.basename(existingPath)
              finalPath = path.join(referencesFolder, path.basename(existingPath))
              break // Found a match, no need to check further
            }
          }
        } catch (err) {
          console.error(`Error comparing files: ${err}`)
        }
      }
    }

    if (existingNotePath) {
      console.log(`Note already exists (same content): ${note}`)
      continue // Skip copying
    }

    // Handle name collisions (different content, same name)
    const existingEntry = Array.from(uniqueNotes).find(
      ([existingPath]) => path.basename(existingPath) === resolvedName,
    )

    const existingCheckRegex = new RegExp(
      `^${path.parse(resolvedName).name}(_[a-zA-Z0-9]+)?\\.[a-zA-Z0-9]+$`,
    )
    collisionDetected = Array.from(uniqueNotes).some(([existingPath]) =>
      existingCheckRegex.test(path.basename(existingPath)),
    )

    if (existingEntry) {
      collisionDetected = true
      const [existingPath, note] = existingEntry
      const newExistingName = await generateUniqueName(existingPath)
      const newExistingPath = path.join(referencesFolder, newExistingName)
      await fs.rename(path.join(referencesFolder, path.basename(existingPath)), newExistingPath)
      uniqueNotes.delete(existingPath) // Remove old entry *before* adding the new one
      uniqueNotes.set(newExistingPath, note)
      renamedFiles[note] = newExistingName
    }

    if (collisionDetected) {
      uniqueName = await generateUniqueName(resolvedPath)
      finalPath = path.join(referencesFolder, uniqueName)
      renamedFiles[note] = uniqueName
    }

    await copyFileToOutput(resolvedPath, finalPath)
    uniqueNotes.set(finalPath, note)

    // Process attachments for this note
    const { attachments } = await parseMarkdownForLinks(resolvedPath)
    await resolveAndCopyAttachments(
      attachments,
      resolvedPath,
      outputDir,
      uniqueAttachments,
      renamedFiles,
    )

    // Recursively resolve and copy nested linked notes
    const { notes: nestedNotes } = await parseMarkdownForLinks(resolvedPath)
    await resolveAndCopyNotes(
      nestedNotes,
      resolvedPath,
      outputDir,
      uniqueAttachments,
      uniqueNotes,
      visitedNotes,
      renamedFiles,
    )
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

// Process a single markdown file
const processMarkdownFile = async (
  filePath,
  outputDir,
  visitedNotes,
  inputType,
  uniqueAttachments,
  uniqueNotes,
  renamedFiles,
) => {
  const destinationPath =
    inputType === "file"
      ? path.join(outputDir, path.basename(filePath)) // Avoid subfolders for single file input
      : path.join(outputDir, path.relative(VAULT_DIR, filePath))

  await copyFileToOutput(filePath, destinationPath)

  const { attachments, notes } = await parseMarkdownForLinks(filePath)

  // Resolve and copy attachments
  await resolveAndCopyAttachments(attachments, filePath, outputDir, uniqueAttachments, renamedFiles)

  // Resolve and copy notes
  await resolveAndCopyNotes(
    notes,
    filePath,
    outputDir,
    uniqueAttachments,
    uniqueNotes,
    visitedNotes,
    renamedFiles,
  )
}

// Update links in the processed file
const updateLinks = async (filePath, renamedFiles) => {
  let content = await fs.readFile(filePath, "utf8")

  // Update Wikilinks
  const wikilinkRegex = /\[\[(?![a-zA-Z][a-zA-Z\d+\-.]*:\/\/)(.+?)(?:\|(.+?))?\]\]/g
  content = content.replace(wikilinkRegex, (match, link, alias) => {
    const isAttachmentLink = path.extname(link) !== ""
    const decodedLink = decodeURIComponent(link)
    const cleanedLink = path.basename(decodedLink) // Remove path from link
    const updatedLink = decodedLink + (isAttachmentLink ? "" : ".md")
    let updatedName = renamedFiles[updatedLink] || cleanedLink
    if (renamedFiles[updatedName]) {
      // Check if the updated name has been renamed again
      updatedName = renamedFiles[updatedName]
    }
    return alias ? `[[${updatedName}|${alias}]]` : `[[${updatedName}]]` // Keep alias if present
  })

  // Update Markdown links
  const markdownLinkRegex = /\[(.+?)\]\((?![a-zA-Z][a-zA-Z\d+\-.]*:\/\/)(.+?)\)/g
  content = content.replace(markdownLinkRegex, (match, text, link) => {
    const decodedLink = decodeURIComponent(link)
    const cleanedLink = path.basename(decodedLink) // Remove path from link
    let updatedName = renamedFiles[decodedLink] || cleanedLink
    if (renamedFiles[updatedName]) {
      // Check if the updated name has been renamed again
      updatedName = renamedFiles[updatedName]
    }
    return `[${text}](${encodeURIComponent(updatedName)})` // Keep displayed text
  })

  await fs.writeFile(filePath, content, "utf8")
}

// Process a folder recursively, skipping files and folders starting with '_'
const processFolder = async (
  folderPath,
  outputDir,
  visitedNotes,
  uniqueAttachments,
  uniqueNotes,
  renamedFiles,
) => {
  const files = await fs.readdir(folderPath, { withFileTypes: true })

  for (const file of files) {
    if (file.name.startsWith("_")) {
      logWarning(`Skipping file or folder: ${file.name}`)
      continue
    }

    const fullPath = path.join(folderPath, file.name)

    if (file.isDirectory()) {
      await processFolder(
        fullPath,
        outputDir,
        visitedNotes,
        uniqueAttachments,
        uniqueNotes,
        renamedFiles,
      )
    } else if (file.name.endsWith(".md")) {
      await processMarkdownFile(
        fullPath,
        outputDir,
        visitedNotes,
        "folder",
        uniqueAttachments,
        uniqueNotes,
        renamedFiles,
      )
    }
  }
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

  // Determine the output directory
  const outputDir = path.join(process.cwd(), path.basename(fullPath).replace(/\.md$/, ""))

  console.log(`\nDestination Path: ${outputDir}\n`)

  try {
    const visitedNotes = new Set()
    const uniqueAttachments = new Map()
    const uniqueNotes = new Map()
    const renamedFiles = {}

    if (stats.isDirectory()) {
      await processFolder(
        fullPath,
        outputDir,
        visitedNotes,
        uniqueAttachments,
        uniqueNotes,
        renamedFiles,
      )
    } else if (stats.isFile() && fullPath.endsWith(".md")) {
      await processMarkdownFile(
        fullPath,
        outputDir,
        visitedNotes,
        "file",
        uniqueAttachments,
        uniqueNotes,
        renamedFiles,
      )
    } else {
      console.error("Invalid input path. Please provide a valid markdown file or folder.")
      return
    }
    // Update links in all files within the output directory
    const updateLinksInDirectory = async (dir) => {
      const files = await fs.readdir(dir, { withFileTypes: true })
      for (const file of files) {
        const fullPath = path.join(dir, file.name)
        if (file.isDirectory()) {
          await updateLinksInDirectory(fullPath)
        } else if (file.name.endsWith(".md")) {
          await updateLinks(fullPath, renamedFiles)
        }
      }
    }

    await updateLinksInDirectory(outputDir)
  } catch (err) {
    console.error(`Error: ${err.message}`)
  }
}

main().catch((err) => console.error(err))

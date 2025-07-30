import * as core from '@actions/core'
import * as fs from 'fs'
import * as path from 'path'
import AdmZip from 'adm-zip'
import axios from 'axios'
import { FormData } from 'formdata-node'
import { fileFromPath } from 'formdata-node/file-from-path'

/**
 * The main function for the action.
 *
 * @returns Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    // Get inputs
    const rootDir = core.getInput('root_dir') || process.cwd()
    const ignoreInput = core.getInput('ignore') || ''
    const realm = core.getInput('realm')
    const repoName = core.getInput('repo_name')
    const apiKey = core.getInput('api_key')

    // Always ignore .git and .github directories
    const ignoreList = ['.git', '.github']

    // Add user-specified ignores
    if (ignoreInput) {
      ignoreList.push(...ignoreInput.split(',').map((item) => item.trim()))
    }

    core.debug(`Root directory: ${rootDir}`)
    core.debug(`Ignore list: ${ignoreList.join(', ')}`)

    // Create a temporary file for the ZIP archive
    const tempZipPath = path.join(process.cwd(), 'repo-archive.zip')

    // Create ZIP archive
    await createZipArchive(rootDir, tempZipPath, ignoreList)

    // Upload the ZIP archive
    await uploadArchive(tempZipPath, realm, repoName, apiKey)

    // Clean up the temporary file
    fs.unlinkSync(tempZipPath)

    core.info('✅ Repository successfully published to PumpRoom')
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) {
      core.setFailed(error.message)
    } else {
      core.setFailed('An unknown error occurred')
    }
  }
}

/**
 * Creates a ZIP archive of the specified directory.
 *
 * @param sourceDir - The directory to archive
 * @param outputPath - The path where the ZIP file will be created
 * @param ignoreList - List of files and directories to ignore
 */
async function createZipArchive(
  sourceDir: string,
  outputPath: string,
  ignoreList: string[]
): Promise<void> {
  core.info('Creating ZIP archive...')

  const zip = new AdmZip()

  // Function to recursively add files to the ZIP
  function addFilesToZip(currentPath: string, relativePath: string = '') {
    const items = fs.readdirSync(currentPath)

    for (const item of items) {
      const itemPath = path.join(currentPath, item)
      const itemRelativePath = relativePath
        ? path.join(relativePath, item)
        : item

      // Skip if the item is in the ignore list
      if (ignoreList.some((ignore) => itemPath.includes(ignore))) {
        core.debug(`Ignoring: ${itemPath}`)
        continue
      }

      const stats = fs.statSync(itemPath)

      if (stats.isDirectory()) {
        // Recursively add files from subdirectories
        addFilesToZip(itemPath, itemRelativePath)
      } else {
        // Add file to ZIP
        core.debug(`Adding file: ${itemPath} as ${itemRelativePath}`)
        zip.addLocalFile(
          itemPath,
          path.dirname(itemRelativePath),
          path.basename(itemRelativePath)
        )
      }
    }
  }

  // Start adding files from the source directory
  addFilesToZip(sourceDir)

  // Write the ZIP file
  zip.writeZip(outputPath)

  core.info(`ZIP archive created at: ${outputPath}`)
}

/**
 * Uploads the ZIP archive to the PumpRoom API.
 *
 * @param zipPath - Path to the ZIP archive
 * @param realm - Realm identifier
 * @param repoName - Repository name
 * @param apiKey - API key for authentication
 */
async function uploadArchive(
  zipPath: string,
  realm: string,
  repoName: string,
  apiKey: string
): Promise<void> {
  core.info('Uploading archive to PumpRoom...')

  try {
    // Create form data
    const formData = new FormData()
    formData.append('repo_name', repoName)
    formData.append('realm', realm)
    formData.append('source', 'github')

    // Add the ZIP file
    const file = await fileFromPath(zipPath)
    formData.append('archive', file)

    // Make the API request
    const response = await axios.post(
      'https://pumproom-api.inzhenerka-cloud.com/repo/index',
      formData,
      {
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'multipart/form-data'
        }
      }
    )

    core.info(`Response status: ${response.status}`)
    core.info(`Response: ${JSON.stringify(response.data)}`)

    if (response.status !== 200) {
      throw new Error(`Unable to register repo, code: ${response.status}`)
    } else {
      core.info('✅ Repo and tasks successfully registered')
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      core.error(`❌ API request failed: ${error.message}`)
      if (error.response) {
        core.error(`Status code: ${error.response.status}`)
        core.error(`Response: ${JSON.stringify(error.response.data)}`)
      }
      throw new Error(`Unable to upload archive: ${error.message}`)
    } else {
      throw error
    }
  }
}

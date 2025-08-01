#!/usr/bin/env node

/**
 * Platform-independent scripts for publishing the GitHub Action
 *
 * This scripts performs the following steps:
 * 1. Checks that current branch is main (required)
 * 2. Checks for uncommitted changes and throws an error if any exist
 * 3. Accepts "minor" or "patch" commands for versioning
 * 4. Builds using "bun all"
 * 5. Commits the result in main
 * 6. Executes npm version, creates tag and pushes main
 * 7. Merges main into v1 release branch and pushes
 *
 * Usage:
 *   node scripts/publish.js <minor|patch>
 */

import { execSync } from 'child_process'
import path from 'path'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Helper function to execute shell commands and print output
function exec(command, options = {}) {
  console.log(`> ${command}`)
  return execSync(command, {
    stdio: 'inherit',
    ...options
  })
}

// Helper function to check if a command exists
function commandExists(command) {
  try {
    execSync(`${command} --version`, { stdio: 'ignore' })
    return true
  } catch (error) {
    return false
  }
}

// Main function
async function main() {
  try {
    // Validate arguments
    const versionType = process.argv[2]
    if (!versionType || (versionType !== 'minor' && versionType !== 'patch')) {
      console.error('Error: Please specify version type: minor or patch')
      console.error('Usage: node scripts/publish.js <minor|patch>')
      process.exit(1)
    }

    // Step 0: Check that current branch is main (REQUIRED)
    try {
      const currentBranch = execSync('git branch --show-current')
        .toString()
        .trim()
      if (currentBranch !== 'main') {
        console.error(
          `Error: Current branch is '${currentBranch}', but 'main' is required for publishing.`
        )
        console.error('Please switch to main branch before publishing.')
        process.exit(1)
      }
      console.log('✓ Current branch is main')
    } catch (error) {
      console.error('Error checking current branch:', error.message)
      process.exit(1)
    }

    // Step 1: Check for uncommitted changes
    try {
      const status = execSync('git status --porcelain').toString().trim()
      if (status) {
        console.error('Error: There are uncommitted changes in the repository.')
        console.error('Please commit or stash your changes before publishing.')
        process.exit(1)
      }
      console.log('✓ No uncommitted changes')
    } catch (error) {
      console.error('Error checking git status:', error.message)
      process.exit(1)
    }

    // Step 2: Build using bun all
    try {
      console.log('Building the project...')
      if (commandExists('bun')) {
        exec('bun all')
      } else {
        console.log('Bun not found, using npm instead')
        exec('npm run all')
      }
    } catch (error) {
      console.error('Error building the project:', error.message)
      process.exit(1)
    }

    // Step 3: Commit the result in main
    try {
      // Check if there are changes to commit after build
      const status = execSync('git status --porcelain').toString().trim()
      if (status) {
        exec('git add .')
        exec('git commit -m "build: update distribution files"')
        console.log('✓ Build changes committed')
      } else {
        console.log('✓ No changes to commit after build')
      }
    } catch (error) {
      console.error('Error committing changes:', error.message)
      process.exit(1)
    }

    // Step 4: Commit version change, create tag and push main
    try {
      // Get current version before update
      const packageJsonPath = path.join(process.cwd(), 'package.json')
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
      const currentVersion = packageJson.version

      // Update version in package.json without creating git tag
      exec(`npm version ${versionType} --no-git-tag-version`)

      // Read the new version
      const updatedPackageJson = JSON.parse(
        readFileSync(packageJsonPath, 'utf8')
      )
      const newVersion = updatedPackageJson.version

      // Commit the version change
      exec('git add package.json')
      exec(
        `git commit -m "chore: bump version from ${currentVersion} to ${newVersion}"`
      )

      // Create tag after commit
      exec(`git tag v${newVersion} -m "v${newVersion} Release"`)

      // Push main with tags
      exec('git push origin main --follow-tags')
      console.log(
        `✓ Version updated from ${currentVersion} to ${newVersion}, committed and pushed to main`
      )
    } catch (error) {
      console.error('Error updating version and pushing main:', error.message)
      process.exit(1)
    }

    // Step 5: Merge main into v1 release branch and push
    try {
      // Check if v1 branch exists, create if not
      const branches = execSync('git branch -r').toString()
      if (!branches.includes('origin/v1')) {
        console.log('Remote v1 branch does not exist. Creating it...')
        exec('git checkout -b v1')
        exec('git push origin v1')
        exec('git checkout main')
      }

      // Switch to v1 branch
      exec('git checkout v1')

      // Pull latest changes from remote v1
      exec('git pull origin v1')

      // Merge main into v1
      exec('git merge main --no-ff -m "Merge main into v1 release branch"')

      // Push v1
      exec('git push origin v1')

      // Switch back to main
      exec('git checkout main')

      console.log('✓ Main merged into v1 release branch')
    } catch (error) {
      console.error('Error merging into v1 and pushing:', error.message)
      process.exit(1)
    }

    console.log('✅ Publication completed successfully!')
    console.log('Process completed: main → tag → push main → merge to v1')
  } catch (error) {
    console.error('An unexpected error occurred:', error.message)
    process.exit(1)
  }
}

// Run the main function
main().catch((error) => {
  console.error('Unhandled error:', error)
  process.exit(1)
})

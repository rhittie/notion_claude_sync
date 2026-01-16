#!/usr/bin/env node

/**
 * Claude Code → Notion Sync Script (v3)
 * 
 * Two-database structure:
 * 1. Projects Database - One row per Claude Code project
 * 2. Features Database - One row per feature file (Kanban view)
 * 
 * Projects link to Features via a Relation property.
 * Each project page contains a linked Kanban view of its features.
 * 
 * ONE-WAY SYNC: Claude Code is the source of truth
 */

require('dotenv').config();
const { Client } = require('@notionhq/client');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

// Initialize Notion client
const notion = new Client({ auth: process.env.NOTION_TOKEN });

// Configuration
const CONFIG = {
  projectsDbId: process.env.NOTION_PROJECTS_DB_ID,
  featuresDbId: process.env.NOTION_FEATURES_DB_ID,
  mappingFile: '.notion-sync.json',
  roadmapDir: 'roadmap',
  readmeFile: 'README.md',
  
  // Folder-to-status mapping
  statusFolders: {
    'backlog': 'Backlog',
    'planned': 'Planned',
    'in-progress': 'In Progress',
    'completed': 'Completed'
  },
  
  // Status order for sorting
  statusOrder: ['In Progress', 'Planned', 'Backlog', 'Completed']
};

/**
 * Generate content hash for change detection
 */
function generateHash(content) {
  return crypto.createHash('md5').update(content).digest('hex').substring(0, 8);
}

/**
 * Load or initialize the sync mapping file
 */
async function loadMapping() {
  try {
    const data = await fs.readFile(CONFIG.mappingFile, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return {
      projectPageId: null,
      lastSync: null,
      featurePageIds: {}, // Map of filePath -> Notion page ID
      contentHashes: {}   // Map of filePath -> content hash
    };
  }
}

/**
 * Save the sync mapping file
 */
async function saveMapping(mapping) {
  await fs.writeFile(
    CONFIG.mappingFile,
    JSON.stringify(mapping, null, 2),
    'utf8'
  );
}

/**
 * Get project name from package.json or directory name
 */
async function getProjectName() {
  try {
    const packageJson = await fs.readFile('package.json', 'utf8');
    const pkg = JSON.parse(packageJson);
    return pkg.name || path.basename(process.cwd());
  } catch (error) {
    return path.basename(process.cwd());
  }
}

/**
 * Read README content
 */
async function readReadme() {
  try {
    return await fs.readFile(CONFIG.readmeFile, 'utf8');
  } catch (error) {
    return null;
  }
}

/**
 * Parse a feature file to extract structured data
 */
function parseFeatureFile(content, filePath) {
  const feature = {
    title: null,
    priority: null,
    complexity: null,
    estimatedSessions: null,
    description: null,
    subtasks: [],
    status: null,
    filePath: filePath,
    hash: generateHash(content)
  };
  
  // Determine status from folder path
  const pathParts = filePath.split(path.sep);
  for (const folder of Object.keys(CONFIG.statusFolders)) {
    if (pathParts.includes(folder)) {
      feature.status = CONFIG.statusFolders[folder];
      break;
    }
  }
  if (!feature.status) {
    feature.status = 'Backlog'; // Default
  }
  
  // Extract Feature title
  const featureMatch = content.match(/^#+ Feature:\s*(.+)$/m);
  if (featureMatch) {
    feature.title = featureMatch[1].trim();
  }
  
  // Extract Priority
  const priorityMatch = content.match(/\*\*Priority:\*\*\s*(\w+)/i);
  if (priorityMatch) {
    feature.priority = priorityMatch[1].trim();
  }
  
  // Extract Complexity
  const complexityMatch = content.match(/\*\*Complexity:\*\*\s*(\w+)/i);
  if (complexityMatch) {
    feature.complexity = complexityMatch[1].trim();
  }
  
  // Extract Estimated Sessions
  const sessionsMatch = content.match(/\*\*Estimated Sessions:\*\*\s*(.+)/i);
  if (sessionsMatch) {
    feature.estimatedSessions = sessionsMatch[1].trim();
  }
  
  // Extract Description
  const descriptionMatch = content.match(/## Description\s*\n([\s\S]*?)(?=\n## |\n# |$)/);
  if (descriptionMatch) {
    feature.description = descriptionMatch[1].trim();
  }
  
  // Extract Subtasks
  const subtasksMatch = content.match(/## Subtasks\s*\n([\s\S]*?)(?=\n## |\n# |$)/);
  if (subtasksMatch) {
    feature.subtasks = parseSubtasks(subtasksMatch[1]);
  }
  
  return feature;
}

/**
 * Parse subtasks from markdown
 */
function parseSubtasks(content) {
  const subtasks = [];
  const lines = content.split('\n');
  let currentPhase = null;
  
  for (const line of lines) {
    // Phase headers
    const phaseMatch = line.match(/^###\s+(.+)$/);
    if (phaseMatch) {
      currentPhase = phaseMatch[1].trim();
      continue;
    }
    
    // Checkbox tasks
    const checkboxMatch = line.match(/^\s*(?:\d+\.\s*)?\[([x ])\]\s+(.+)$/i);
    if (checkboxMatch) {
      subtasks.push({
        text: checkboxMatch[2].trim(),
        completed: checkboxMatch[1].toLowerCase() === 'x',
        phase: currentPhase
      });
      continue;
    }
    
    // Numbered tasks without checkbox
    const numberedMatch = line.match(/^\s*(\d+)\.\s+(?!\[)(.+)$/);
    if (numberedMatch) {
      subtasks.push({
        text: numberedMatch[2].trim(),
        completed: false,
        phase: currentPhase
      });
    }
  }
  
  return subtasks;
}

/**
 * Scan roadmap directory for feature files
 */
async function scanRoadmapFeatures() {
  const features = [];
  
  async function scanDir(dir) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          await scanDir(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('_')) {
          try {
            const content = await fs.readFile(fullPath, 'utf8');
            const feature = parseFeatureFile(content, fullPath);
            
            if (feature.title) {
              features.push(feature);
            }
          } catch (err) {
            console.warn(`⚠️  Could not read ${fullPath}: ${err.message}`);
          }
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn(`⚠️  Error scanning ${dir}: ${error.message}`);
      }
    }
  }
  
  await scanDir(CONFIG.roadmapDir);
  
  // Sort by status, then filename
  features.sort((a, b) => {
    const statusDiff = CONFIG.statusOrder.indexOf(a.status) - CONFIG.statusOrder.indexOf(b.status);
    if (statusDiff !== 0) return statusDiff;
    return a.filePath.localeCompare(b.filePath);
  });
  
  return features;
}

/**
 * Search for existing project page by name
 */
async function findProjectPage(projectName) {
  try {
    const response = await notion.databases.query({
      database_id: CONFIG.projectsDbId,
      filter: {
        property: 'Name',
        title: { equals: projectName }
      }
    });
    
    return response.results.length > 0 ? response.results[0].id : null;
  } catch (error) {
    console.error('Error searching for project:', error.message);
    return null;
  }
}

/**
 * Search for existing feature page by title and project
 */
async function findFeaturePage(featureTitle, projectPageId) {
  try {
    const response = await notion.databases.query({
      database_id: CONFIG.featuresDbId,
      filter: {
        and: [
          { property: 'Name', title: { equals: featureTitle } },
          { property: 'Project', relation: { contains: projectPageId } }
        ]
      }
    });
    
    return response.results.length > 0 ? response.results[0].id : null;
  } catch (error) {
    console.error('Error searching for feature:', error.message);
    return null;
  }
}

/**
 * Create subtask blocks for a feature page
 */
function createSubtaskBlocks(subtasks) {
  const blocks = [];
  let currentPhase = null;
  
  for (const task of subtasks) {
    // Add phase header if changed
    if (task.phase && task.phase !== currentPhase) {
      currentPhase = task.phase;
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: [{ type: 'text', text: { content: task.phase } }]
        }
      });
    }
    
    // Add task as to_do
    blocks.push({
      object: 'block',
      type: 'to_do',
      to_do: {
        rich_text: [{ type: 'text', text: { content: task.text } }],
        checked: task.completed
      }
    });
  }
  
  return blocks;
}

/**
 * Create or update a feature in the Features database
 */
async function syncFeature(feature, projectPageId, mapping) {
  let existingPageId = mapping.featurePageIds[feature.filePath];
  const existingHash = mapping.contentHashes[feature.filePath];
  
  // Skip if unchanged
  if (existingPageId && existingHash === feature.hash) {
    // Still verify the page exists
    try {
      await notion.pages.retrieve({ page_id: existingPageId });
      return { pageId: existingPageId, action: 'unchanged' };
    } catch (error) {
      // Page was deleted, recreate it
    }
  }
  
  // Build properties
  const properties = {
    Name: {
      title: [{ text: { content: feature.title } }]
    },
    Status: {
      status: { name: feature.status }
    },
    Project: {
      relation: [{ id: projectPageId }]
    }
  };
  
  // Add Priority if exists
  if (feature.priority) {
    properties.Priority = {
      select: { name: feature.priority }
    };
  }
  
  // Add Complexity if exists
  if (feature.complexity) {
    properties.Complexity = {
      select: { name: feature.complexity }
    };
  }
  
  // Build page content
  const children = [];
  
  // Description
  if (feature.description) {
    // Split description into paragraphs (Notion has 2000 char limit per block)
    const chunks = feature.description.match(/.{1,1900}/gs) || [];
    for (const chunk of chunks) {
      children.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: chunk } }]
        }
      });
    }
  }
  
  // Divider before subtasks
  if (feature.subtasks.length > 0) {
    children.push({ object: 'block', type: 'divider', divider: {} });
    children.push({
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [{ type: 'text', text: { content: '📋 Subtasks' } }]
      }
    });
    children.push(...createSubtaskBlocks(feature.subtasks));
  }
  
  // Source file reference
  children.push({ object: 'block', type: 'divider', divider: {} });
  children.push({
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{ 
        type: 'text', 
        text: { content: `📁 Source: ${feature.filePath}` },
        annotations: { color: 'gray', italic: true }
      }]
    }
  });
  
  let pageId;
  let action;
  
  if (existingPageId) {
    // Update existing page
    try {
      await notion.pages.update({
        page_id: existingPageId,
        properties
      });
      
      // Delete existing content and replace
      const existingBlocks = await notion.blocks.children.list({ block_id: existingPageId });
      for (const block of existingBlocks.results) {
        try {
          await notion.blocks.delete({ block_id: block.id });
        } catch (e) {
          // Ignore deletion errors
        }
      }
      
      // Add new content
      if (children.length > 0) {
        await notion.blocks.children.append({
          block_id: existingPageId,
          children
        });
      }
      
      pageId = existingPageId;
      action = 'updated';
    } catch (error) {
      // Page doesn't exist anymore, create new
      existingPageId = null;
    }
  }
  
  if (!existingPageId) {
    // Create new page
    const page = await notion.pages.create({
      parent: { database_id: CONFIG.featuresDbId },
      properties,
      children
    });
    pageId = page.id;
    action = 'created';
  }
  
  return { pageId, action };
}

/**
 * Create or update the project page
 */
async function syncProject(projectName, readme, featureCount, mapping) {
  let pageId = mapping.projectPageId;
  
  // Verify existing page still exists
  if (pageId) {
    try {
      await notion.pages.retrieve({ page_id: pageId });
    } catch (error) {
      pageId = null;
    }
  }
  
  // Search by name if needed
  if (!pageId) {
    pageId = await findProjectPage(projectName);
  }
  
  const properties = {
    Name: {
      title: [{ text: { content: projectName } }]
    }
  };

  // Note: 'Feature Count' and 'Last Synced' properties are optional.
  // Add them to your Notion Projects database if you want them synced.
  
  if (pageId) {
    // Update existing project
    await notion.pages.update({
      page_id: pageId,
      properties
    });
    
    return { pageId, action: 'updated' };
  } else {
    // Create new project with embedded database view instructions
    const children = [];
    
    // README excerpt if available
    if (readme) {
      const excerpt = readme.substring(0, 500) + (readme.length > 500 ? '...' : '');
      children.push({
        object: 'block',
        type: 'callout',
        callout: {
          rich_text: [{ type: 'text', text: { content: excerpt } }],
          icon: { emoji: '📖' }
        }
      });
    }
    
    children.push({ object: 'block', type: 'divider', divider: {} });
    
    // Instructions for adding Kanban view
    children.push({
      object: 'block',
      type: 'callout',
      callout: {
        rich_text: [{ 
          type: 'text', 
          text: { content: '👆 Add a linked view of your Features database here:\n1. Type /linked\n2. Select "Linked view of database"\n3. Choose your Features database\n4. Filter by: Project → contains → ' + projectName + '\n5. Change view to "Board" and group by Status' }
        }],
        icon: { emoji: '⚙️' },
        color: 'gray_background'
      }
    });
    
    const page = await notion.pages.create({
      parent: { database_id: CONFIG.projectsDbId },
      properties,
      children
    });
    
    return { pageId: page.id, action: 'created' };
  }
}

/**
 * Remove features from Notion that no longer exist in code
 */
async function cleanupDeletedFeatures(currentFeatures, projectPageId, mapping) {
  const currentPaths = new Set(currentFeatures.map(f => f.filePath));
  const removedCount = { archived: 0 };
  
  for (const [filePath, pageId] of Object.entries(mapping.featurePageIds)) {
    if (!currentPaths.has(filePath)) {
      try {
        // Archive the page (soft delete)
        await notion.pages.update({
          page_id: pageId,
          archived: true
        });
        removedCount.archived++;
        delete mapping.featurePageIds[filePath];
        delete mapping.contentHashes[filePath];
      } catch (error) {
        // Page might already be deleted
        delete mapping.featurePageIds[filePath];
        delete mapping.contentHashes[filePath];
      }
    }
  }
  
  return removedCount;
}

/**
 * Main sync function
 */
async function syncToNotion() {
  console.log('🚀 Starting Notion sync (v3 - Kanban)...\n');
  
  // Validate environment
  if (!process.env.NOTION_TOKEN) {
    console.error('❌ NOTION_TOKEN not found');
    console.error('   Add it to your .env file');
    process.exit(1);
  }
  
  if (!process.env.NOTION_PROJECTS_DB_ID) {
    console.error('❌ NOTION_PROJECTS_DB_ID not found');
    console.error('   Add your Projects database ID to .env');
    process.exit(1);
  }
  
  if (!process.env.NOTION_FEATURES_DB_ID) {
    console.error('❌ NOTION_FEATURES_DB_ID not found');
    console.error('   Add your Features database ID to .env');
    process.exit(1);
  }
  
  try {
    // Load mapping
    const mapping = await loadMapping();
    
    // Get project info
    const projectName = await getProjectName();
    console.log(`📦 Project: ${projectName}\n`);
    
    // Read content
    const readme = await readReadme();
    const features = await scanRoadmapFeatures();
    
    // Summary
    const statusCounts = {};
    for (const f of features) {
      statusCounts[f.status] = (statusCounts[f.status] || 0) + 1;
    }
    
    console.log(`📋 Found ${features.length} features:`);
    for (const status of CONFIG.statusOrder) {
      if (statusCounts[status]) {
        console.log(`   ${status}: ${statusCounts[status]}`);
      }
    }
    console.log('');
    
    // Sync project first
    console.log('📁 Syncing project...');
    const projectResult = await syncProject(projectName, readme, features.length, mapping);
    mapping.projectPageId = projectResult.pageId;
    console.log(`   Project ${projectResult.action}: ${projectName}`);
    
    // Sync each feature
    console.log('\n📋 Syncing features...');
    let created = 0, updated = 0, unchanged = 0;
    
    for (const feature of features) {
      const result = await syncFeature(feature, mapping.projectPageId, mapping);
      
      mapping.featurePageIds[feature.filePath] = result.pageId;
      mapping.contentHashes[feature.filePath] = feature.hash;
      
      if (result.action === 'created') {
        created++;
        console.log(`   ✨ Created: ${feature.title}`);
      } else if (result.action === 'updated') {
        updated++;
        console.log(`   🔄 Updated: ${feature.title}`);
      } else {
        unchanged++;
      }
    }
    
    // Cleanup deleted features
    const cleanup = await cleanupDeletedFeatures(features, mapping.projectPageId, mapping);
    if (cleanup.archived > 0) {
      console.log(`   🗑️  Archived ${cleanup.archived} removed features`);
    }
    
    // Save mapping
    mapping.lastSync = new Date().toISOString();
    await saveMapping(mapping);
    
    // Summary
    console.log('\n✨ Sync complete!');
    console.log(`   Created: ${created}`);
    console.log(`   Updated: ${updated}`);
    console.log(`   Unchanged: ${unchanged}`);
    console.log(`   Last sync: ${mapping.lastSync}`);
    
    if (projectResult.action === 'created') {
      console.log('\n⚠️  New project created! To add the Kanban view:');
      console.log('   1. Open the project page in Notion');
      console.log('   2. Type /linked and select "Linked view of database"');
      console.log('   3. Choose your Features database');
      console.log(`   4. Add filter: Project contains "${projectName}"`);
      console.log('   5. Change view type to "Board"');
      console.log('   6. Group by "Status"');
    }
    
  } catch (error) {
    console.error('\n❌ Sync failed:', error.message);
    if (error.body) {
      console.error('Details:', JSON.stringify(error.body, null, 2));
    }
    process.exit(1);
  }
}

// Run
syncToNotion();

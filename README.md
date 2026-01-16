# Claude Code → Notion Sync (v3 - Kanban)

Two-database sync system that creates a Kanban board of features for each project.

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│  PROJECTS DATABASE (Gallery/Table view)                     │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │
│  │ robotics    │ │ rss-gen     │ │ home-auto   │           │
│  │ 12 features │ │ 5 features  │ │ 8 features  │           │
│  └─────────────┘ └─────────────┘ └─────────────┘           │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼ click into project
┌─────────────────────────────────────────────────────────────┐
│  FEATURES DATABASE (Kanban view, filtered by project)       │
│  ┌──────────┬──────────┬──────────┬──────────┐             │
│  │ Backlog  │ Planned  │ In Prog  │ Complete │             │
│  ├──────────┼──────────┼──────────┼──────────┤             │
│  │ Export   │ API Keys │ Dashboard│ Tests    │             │
│  │ [Medium] │ [High]   │ [High]   │ [High]   │             │
│  ├──────────┤          │          ├──────────┤             │
│  │ Mobile   │          │          │ Search   │             │
│  │ [Low]    │          │          │ [Medium] │             │
│  └──────────┴──────────┴──────────┴──────────┘             │
└─────────────────────────────────────────────────────────────┘
```

## Setup

### 1. Create Two Notion Databases

#### Projects Database
Create a database with these properties:
| Property | Type | Required |
|----------|------|----------|
| Name | Title | ✅ |
| Feature Count | Number | Optional |
| Last Synced | Date | Optional |

#### Features Database
Create a database with these properties:
| Property | Type | Required |
|----------|------|----------|
| Name | Title | ✅ |
| Status | Status | ✅ |
| Project | Relation → Projects | ✅ |
| Priority | Select | Optional |
| Complexity | Select | Optional |

**Important:** For the Status property, add these options:
- Backlog
- Planned
- In Progress
- Completed

**Important:** For Priority select, add:
- High
- Medium
- Low

### 2. Share Both Databases with Your Integration

1. Go to https://www.notion.so/my-integrations
2. Create integration (or use existing "Claude Code Sync")
3. Open each database → "..." menu → Connections → Add your integration

### 3. Get Database IDs

For each database:
1. Open as full page
2. Copy URL: `https://notion.so/workspace/DATABASE_ID?v=...`
3. The DATABASE_ID is the 32-character string

### 4. Configure Environment

Create `.env` file:

```bash
NOTION_TOKEN=secret_your_token_here
NOTION_PROJECTS_DB_ID=your_projects_database_id
NOTION_FEATURES_DB_ID=your_features_database_id
```

### 5. Install & Run

```bash
npm install
npm run sync
```

### 6. Add Kanban View to Project Page

After first sync, open your project page in Notion and add the Kanban:

1. Click where you want the board
2. Type `/linked` and select **"Linked view of database"**
3. Choose your **Features** database
4. Click **"Filter"** → Add filter:
   - Property: `Project`
   - Condition: `contains`
   - Value: *(select your project)*
5. Click the view dropdown → **"Board"**
6. Set "Group by" to **Status**

Now you have a Kanban board showing only that project's features!

## File Structure

Your Claude Code project:
```
your-project/
├── README.md
├── roadmap/
│   ├── backlog/
│   │   └── 001-feature.md
│   ├── planned/
│   │   └── 001-feature.md
│   ├── in-progress/
│   │   └── 001-feature.md
│   └── completed/
│       └── 001-feature.md
├── sync-to-notion.js
├── package.json
├── .env
└── .notion-sync.json  (auto-generated)
```

## Feature File Format

```markdown
# Feature: Your Feature Title

## Metadata
- **Priority:** High
- **Complexity:** Medium
- **Estimated Sessions:** 2-3

## Description
What this feature does and why it matters.

## Subtasks

### Phase 1: Setup
1. [ ] First task
2. [ ] Second task

### Phase 2: Build
3. [ ] Third task
4. [x] Completed task
```

## What Gets Synced

| From Markdown | To Notion |
|---------------|-----------|
| `# Feature:` title | Card name |
| Folder location | Status property |
| `**Priority:**` | Priority select |
| `**Complexity:**` | Complexity select |
| `## Description` | Card content |
| `## Subtasks` | To-do checkboxes |

## Folder → Status Mapping

| Folder | Status |
|--------|--------|
| `roadmap/backlog/` | Backlog |
| `roadmap/planned/` | Planned |
| `roadmap/in-progress/` | In Progress |
| `roadmap/completed/` | Completed |

## Automation

### Git Hook
```bash
npm run setup-hooks
```

### Cron (Monday 9 AM)
```bash
chmod +x setup-cron.sh
./setup-cron.sh
```

## Sync Behavior

- **New features:** Creates card in Features database
- **Changed features:** Updates existing card (by file path)
- **Deleted features:** Archives the card in Notion
- **Moved between folders:** Updates Status property
- **Unchanged features:** Skipped (uses content hashing)

## One-Way Sync

Claude Code → Notion only.

- Edit features in your markdown files
- Move files between folders to change status
- Notion reflects your code

If you drag a card to a different status column in Notion, it **won't** update your markdown files. The next sync will move it back.

## Multiple Projects

Same setup for each project:
1. Copy sync files to project
2. Use same `.env` credentials
3. Run `npm run sync`

Each project creates its own row in Projects database with its own Kanban of features.

## Troubleshooting

### "Property 'Status' not found"
Your Features database needs a Status property of type "Status" (not Select).

### "Property 'Project' not found"  
Add a Relation property called "Project" that links to your Projects database.

### Features not appearing in Kanban
Check your linked view filter - it should be `Project contains [your project]`.

### Status options not matching
Add these exact status options: Backlog, Planned, In Progress, Completed

## .gitignore

```
.env
.notion-sync.json
notion-sync.log
node_modules/
```

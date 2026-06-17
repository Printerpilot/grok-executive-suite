#!/usr/bin/env node
/**
 * Prepare sanitized app state for public marketing screenshots.
 * Backs up live state, writes demo-safe content (no personal paths, credentials, or business details).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = path.join(os.homedir(), '.grok-cowork');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const BACKUP_STATE = path.join(DATA_DIR, 'state.json.bak-marketing');
const PROJ_ID = 'proj-marketing';
const PROJ_DIR = path.join(DATA_DIR, 'projects', PROJ_ID);
const FUSION_TASK = 'task-marketing-fusion';
const GUI_TASK = 'task-marketing-gui';
const SCHED_ID = 'commit-digest';

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function backup(file, backupFile) {
  if (fs.existsSync(file)) {
    fs.copyFileSync(file, backupFile);
    console.log('[marketing] backed up', file);
  }
}

const now = new Date().toISOString();
const hourAgo = new Date(Date.now() - 3600000).toISOString();

const marketingState = {
  activeProjectId: PROJ_ID,
  projects: [
    {
      id: 'general',
      name: 'General Workspace',
      rootPath: '~/Documents',
      workingFolders: [],
      grokSessionId: null
    },
    {
      id: PROJ_ID,
      name: 'Grok GUI Development',
      rootPath: '~/grok-cowork-app',
      workingFolders: [
        '~/grok-cowork-app/renderer',
        '~/grok-cowork-app/assets'
      ],
      grokSessionId: null
    },
    {
      id: 'proj-endless-wallet',
      name: 'Endless Wallet',
      rootPath: '~/Projects/Endless-Wallet',
      workingFolders: ['~/Projects/Endless-Wallet'],
      grokSessionId: null
    }
  ],
  scheduledTasks: [
    {
      id: SCHED_ID,
      name: 'Hourly commit digest',
      description: 'Summarize recent changes across project working folders.',
      cron: '0 * * * *',
      enabled: true,
      lastRun: hourAgo,
      runs: [
        {
          id: 'run-marketing-1',
          startedAt: hourAgo,
          completedAt: hourAgo,
          status: 'completed',
          viewed: true,
          messages: [
            {
              role: 'assistant',
              content: 'Hourly digest: no file changes in working folders during the last window. renderer/ and assets/ unchanged.'
            }
          ]
        },
        {
          id: 'run-marketing-2',
          startedAt: now,
          completedAt: now,
          status: 'completed',
          viewed: false,
          messages: [
            {
              role: 'assistant',
              content: 'Scheduled run complete. Working folders scanned; no new artifacts to report.'
            }
          ]
        }
      ]
    }
  ],
  dispatches: [],
  progress: { [PROJ_ID]: [] },
  connectors: ['filesystem', 'web-search', 'terminal'],
  actWithoutAsking: true
};

const manifest = {
  activeTaskId: FUSION_TASK,
  tasks: [
    {
      id: FUSION_TASK,
      title: 'Autodesk Fusion Tests',
      createdAt: now,
      updatedAt: now,
      grokSessionId: null,
      progress: [
        { id: 'p1', label: 'Review export test suites', done: true },
        { id: 'p2', label: 'Run assembly stress scenarios', done: false },
        { id: 'p3', label: 'Summarize coverage gaps', done: false }
      ],
      sessionFolders: ['~/grok-cowork-app/renderer'],
      sessionConnectors: [
        { name: 'Terminal / Shell', lastUsed: now },
        { name: 'Filesystem', lastUsed: now },
        { name: 'Web Search', lastUsed: now }
      ]
    },
    {
      id: GUI_TASK,
      title: 'Grok GUI Development — current',
      createdAt: now,
      updatedAt: now,
      grokSessionId: null,
      progress: [
        { id: 'g1', label: 'Marketing screenshot pipeline', done: true },
        { id: 'g2', label: 'Distinct sidebar + panels view', done: true },
        { id: 'g3', label: 'Publish assets to GitHub README', done: false }
      ],
      sessionFolders: [
        '~/grok-cowork-app/renderer',
        '~/grok-cowork-app/assets'
      ],
      sessionConnectors: [
        { name: 'Filesystem', lastUsed: now },
        { name: 'Web Search', lastUsed: now },
        { name: 'Terminal / Shell', lastUsed: now }
      ]
    }
  ]
};

const fusionChat = [
  {
    role: 'user',
    content: 'Summarize the Fusion export tests and flag anything missing.'
  },
  {
    role: 'assistant',
    content: 'I reviewed the export test folder. Three suites pass cleanly. Assembly stress tests need one additional edge case for thin-wall geometry. I can draft that test next if you want.'
  }
].map(m => JSON.stringify(m)).join('\n') + '\n';

backup(STATE_FILE, BACKUP_STATE);
writeJson(STATE_FILE, marketingState);
writeJson(path.join(PROJ_DIR, 'manifest.json'), manifest);
fs.mkdirSync(path.join(PROJ_DIR, FUSION_TASK), { recursive: true });
fs.writeFileSync(path.join(PROJ_DIR, FUSION_TASK, 'chat.jsonl'), fusionChat);
const guiChat = [
  {
    role: 'user',
    content: 'how are you doing with the phase 3 work?'
  },
  {
    role: 'assistant',
    content: 'Screenshot pipeline is built. I added a distinct GUI-task view for sidebar and panels, switched to Electron capturePage to avoid the macOS permission dialog, and I am re-running captures now.'
  }
].map(m => JSON.stringify(m)).join('\n') + '\n';

fs.mkdirSync(path.join(PROJ_DIR, GUI_TASK), { recursive: true });
fs.writeFileSync(path.join(PROJ_DIR, GUI_TASK, 'chat.jsonl'), guiChat);
fs.mkdirSync(path.join(PROJ_DIR, GUI_TASK, 'attachments'), { recursive: true });
fs.writeFileSync(
  path.join(PROJ_DIR, GUI_TASK, 'attachments', 'capture-marketing-screenshots.sh'),
  '#!/usr/bin/env bash\n# Marketing capture helper (demo artifact)\n'
);

console.log('[marketing] Sanitized state ready at', STATE_FILE);
console.log('[marketing] Active project:', PROJ_ID, '| Active task: Autodesk Fusion Tests');
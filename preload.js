const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('grokCoworkAPI', {
  // State & Projects (general, no baked-in context)
  getState: () => ipcRenderer.invoke('get-state'),
  createProject: (data) => ipcRenderer.invoke('create-project', data),
  switchProject: (id) => ipcRenderer.invoke('switch-project', id),
  addWorkingFolder: (folder) => ipcRenderer.invoke('add-working-folder', folder),

  // Cowork core (Scheduled + Dispatch persist and are real)
  addDispatch: (label) => ipcRenderer.invoke('add-dispatch', label),
  runDispatch: (id) => ipcRenderer.invoke('run-dispatch', id),
  addScheduled: (task) => ipcRenderer.invoke('add-scheduled', task),
  runScheduled: (id) => ipcRenderer.invoke('run-scheduled', id),
  renameScheduledTask: (data) => ipcRenderer.invoke('rename-scheduled-task', data),
  deleteScheduledTask: (taskId) => ipcRenderer.invoke('delete-scheduled-task', taskId),
  markScheduledViewed: (data) => ipcRenderer.invoke('mark-scheduled-viewed', data),
  onScheduledRunUpdated: (cb) => ipcRenderer.on('scheduled-run-updated', (_e, data) => cb(data)),
  onScheduledRunStarted: (cb) => ipcRenderer.on('scheduled-run-started', (_e, data) => cb(data)),

  // Progress & Context
  updateProgress: (items) => ipcRenderer.invoke('update-progress', items),
  updateTaskProgress: (data) => ipcRenderer.invoke('update-task-progress', data),
  addTaskSessionFolder: (data) => ipcRenderer.invoke('add-task-session-folder', data),
  addTaskSessionConnector: (data) => ipcRenderer.invoke('add-task-session-connector', data),
  renameConversationTask: (data) => ipcRenderer.invoke('rename-conversation-task', data),
  deleteConversationTask: (data) => ipcRenderer.invoke('delete-conversation-task', data),
  syncTaskSession: () => ipcRenderer.invoke('sync-task-session'),
  getConnectors: () => ipcRenderer.invoke('get-connectors'),
  onTaskSessionUpdated: (cb) => ipcRenderer.on('task-session-updated', (_e, data) => cb(data)),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  openPath: (targetPath) => ipcRenderer.invoke('open-path', targetPath),
  listArtifacts: () => ipcRenderer.invoke('list-artifacts'),

  // Run any prompt with full current Cowork workspace context injected
  runCoworkPrompt: (prompt) => ipcRenderer.invoke('run-cowork-prompt', prompt),
  stopGrok: () => ipcRenderer.invoke('stop-grok'),
  saveAttachment: (data) => ipcRenderer.invoke('save-attachment', data),
  getAttachmentPreview: (filePath) => ipcRenderer.invoke('get-attachment-preview', filePath),

  // Conversation tasks (persisted per project)
  getBootContext: () => ipcRenderer.invoke('get-boot-context'),
  getSetupStatus: () => ipcRenderer.invoke('get-setup-status'),
  listTasks: (projectId) => ipcRenderer.invoke('list-tasks', projectId),
  createConversationTask: (data) => ipcRenderer.invoke('create-conversation-task', data),
  switchConversationTask: (taskId) => ipcRenderer.invoke('switch-conversation-task', taskId),
  getTaskHistory: (data) => ipcRenderer.invoke('get-task-history', data),
  appendTaskMessages: (data) => ipcRenderer.invoke('append-task-messages', data),

  // Computer Use (real & native)
  captureScreen: () => ipcRenderer.invoke('capture-screen'),
  desktopAction: (action, params) => ipcRenderer.invoke('desktop-action', { action, params }),

  // Rich streaming events from Grok
  onGrokEvent: (cb) => ipcRenderer.on('grok-event', (_e, data) => cb(data)),
  onTriggerCapture: (cb) => ipcRenderer.on('trigger-capture', () => cb()),
  onCreateProjectFromUI: (cb) => ipcRenderer.on('create-project-from-ui', (_e, rootPath) => cb(rootPath)),

  // Platform
  platform: process.platform,

  // For the Act banner toggle
  setActWithoutAsking: (value) => ipcRenderer.invoke('set-act-without-asking', value)
});
#!/usr/bin/env node
/**
 * MCP server: macOS desktop control for Grok Build.
 * Exposes mouse, keyboard, and app-focus actions used by Grok Executive Suite.
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const controlCandidates = [
  path.join(__dirname, 'lib/desktop-control.cjs'),
  path.join(__dirname, '../../lib/desktop-control.js')
];
const controlPath = controlCandidates.find(p => {
  try { return require('fs').existsSync(p); } catch { return false; }
});
if (!controlPath) throw new Error('desktop-control module not found');
const { runDesktopAction } = require(controlPath);

const TOOLS = [
  {
    name: 'get_cursor_position',
    description: 'Get current mouse cursor coordinates (x, y) on the main display.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'move_cursor',
    description: 'Move the mouse cursor to screen coordinates.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Horizontal position in pixels' },
        y: { type: 'number', description: 'Vertical position in pixels' }
      },
      required: ['x', 'y'],
      additionalProperties: false
    }
  },
  {
    name: 'click',
    description: 'Click at screen coordinates (left, right, or double-click).',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        button: { type: 'string', enum: ['left', 'right'], default: 'left' },
        clickCount: { type: 'integer', minimum: 1, maximum: 2, default: 1 }
      },
      required: ['x', 'y'],
      additionalProperties: false
    }
  },
  {
    name: 'type_text',
    description: 'Type text via the keyboard into the focused application.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to type' }
      },
      required: ['text'],
      additionalProperties: false
    }
  },
  {
    name: 'press_key',
    description: 'Press a key by key code with optional modifiers (cmd, shift, option, control).',
    inputSchema: {
      type: 'object',
      properties: {
        keyCode: { type: 'integer', description: 'macOS key code (36 = Return)' },
        modifiers: {
          type: 'array',
          items: { type: 'string', enum: ['cmd', 'shift', 'option', 'control'] }
        }
      },
      required: ['keyCode'],
      additionalProperties: false
    }
  },
  {
    name: 'open_app',
    description: 'Launch a macOS application by name (e.g. "Calculator", "Safari").',
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string' }
      },
      required: ['app'],
      additionalProperties: false
    }
  },
  {
    name: 'focus_app',
    description: 'Bring a running macOS application to the foreground.',
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string' }
      },
      required: ['app'],
      additionalProperties: false
    }
  }
];

async function handleTool(name, args = {}) {
  switch (name) {
    case 'get_cursor_position':
      return runDesktopAction('get-cursor');
    case 'move_cursor':
      return runDesktopAction('move-cursor', { x: args.x, y: args.y });
    case 'click': {
      const count = args.clickCount || 1;
      const action = args.button === 'right' ? 'right-click' : count >= 2 ? 'double-click' : 'click';
      return runDesktopAction(action, { x: args.x, y: args.y, clickCount: count });
    }
    case 'type_text':
      return runDesktopAction('type', { text: args.text });
    case 'press_key':
      return runDesktopAction('key', { keyCode: args.keyCode, modifiers: args.modifiers || [] });
    case 'open_app':
      return runDesktopAction('open-app', { app: args.app });
    case 'focus_app':
      return runDesktopAction('focus-app', { app: args.app });
    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}

const server = new Server(
  { name: 'executive-suite-desktop', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const result = await handleTool(name, args || {});
    const text = JSON.stringify(result, null, 2);
    return {
      content: [{ type: 'text', text }],
      isError: !result.ok
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ ok: false, error: err.message }) }],
      isError: true
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
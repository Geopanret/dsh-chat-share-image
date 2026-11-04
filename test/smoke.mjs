/**
 * Static smoke test for dsh-chat-share-image.
 *
 * Run with: node test/smoke.mjs
 * It checks the bundle manifest, the client registration surface, locale key
 * parity and the icon resource. It does not touch the running Harness.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const failures = [];

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

function check(condition, message) {
  if (!condition) failures.push(message);
}

const pkg = JSON.parse(read('package.json'));
check(pkg.name === 'dsh-chat-share-image', 'package name must be dsh-chat-share-image');
check(pkg.private !== true, 'publishable package must not be private');
check(pkg.version === '0.2.0', 'version must be 0.2.0');
check(pkg.license === 'MIT', 'license must be MIT');
check(typeof pkg.repository?.url === 'string', 'repository is required for GitHub distribution');
check(pkg.engines?.dsh === '>=0.2.0 <0.3.0', 'engines.dsh must cover the current runtime');
check(pkg.dsh?.manifestVersion === 1, 'dsh.manifestVersion must be 1');
check(pkg.type === 'module', 'package must be an ES module');
check(typeof pkg.exports?.['.'] === 'string', 'exports["."] is required');
check(pkg.exports?.['./client'] === './client.js', 'exports["./client"] must point at client.js');
check(pkg.exports?.['./locale/*.json'] === './locale/*.json', 'locale exports are required');
check(pkg.exports?.['./icon'] === './icon.svg', 'icon export is required');
check(pkg.dsh?.bundle?.patch === './cordis.patch.yml', 'dsh.bundle.patch is required');
check(pkg.dsh?.client?.platform === 'web', 'dsh.client.platform must be web');
check(pkg.dsh?.client?.immediately === true, 'dsh.client.immediately must be true');
const inject = pkg.dsh?.client?.inject ?? [];
check(inject.includes('@deepseek-ai/dsh-client-ui-conversation'), 'client inject must wait for the conversation UI');
check(inject.includes('@deepseek-ai/dsh-client-locale'), 'client inject must wait for the locale service');
check(Array.isArray(pkg.files) && pkg.files.includes('client.js'), 'files must include client.js');

const patch = read('cordis.patch.yml');
check(patch.includes('chat-share-image'), 'patch row id must be chat-share-image');
check(patch.includes(pkg.name), 'patch row must load the package');
check(read('index.js').includes('export function apply'), 'Host half must export apply()');

const client = read('client.js');
check(client.includes('window.__ModuleLoader__.load'), 'client.js must register through window.__ModuleLoader__');
check(client.trim().includes("id: 'dsh-chat-share-image'"), 'client module id must equal the package name');
check(client.includes("'conversation.chat.assistant-actions'"), 'client must inject the assistant action strip');
check(client.includes("const ACTION_ID = 'share-image'"), 'action cell id must be share-image');
check(client.includes("'shell.overlay'"), 'client must inject the shell overlay');
check(client.includes("const TOAST_ID = 'chat-share-image-toast'"), 'toast cell id must be chat-share-image-toast');
check(client.includes('ctx.locale.register(NS'), 'client must register its locale dictionary');
check(client.includes("locale: NS"), 'slot entries must bind the locale namespace');
check(client.includes('ClipboardItem'), 'client must write an image through ClipboardItem');
check(client.includes('const PAPER_CLASS'), 'client must define the screenshot paper layer');
check(client.includes('clearFrozenLayout'), 'client must clear frozen UI layout before re-flow');
check(client.includes('computePaperWidth'), 'client must compute a paper width for tables');
check(client.includes('enlargeReferencedImages'), 'client must enlarge referenced image previews');
check(client.includes('MAX_PAPER'), 'client must cap the paper width');
check(client.includes('object-fit'), 'paper layout must disable preview cropping');
check(client.includes('segmentHeightFor'), 'client must split overlong replies into readable segments');
check(client.includes('verifyPngBlob'), 'client must self-check the produced PNG');
check(client.includes('MAX_PARTS'), 'client must guard against absurdly long replies');
check(client.includes('toast.copiedParts'), 'client must explain multi-part output');
check(!/from ['"]react['"]/.test(client), 'client must not import React by package specifier');

try {
  new Function(client); // parse only, never executed
} catch (error) {
  failures.push('client.js does not parse: ' + error.message);
}

function localeKeys(source, name) {
  const start = source.indexOf('const ' + name + ' = {');
  check(start !== -1, 'client.js must define ' + name);
  if (start === -1) return new Set();
  const end = source.indexOf('\n    };', start);
  check(end !== -1, name + ' block must be terminated');
  if (end === -1) return new Set();
  const block = source.slice(start, end);
  const keys = new Set();
  for (const match of block.matchAll(/^\s*'([^']+)':/gm)) keys.add(match[1]);
  return keys;
}

const zhKeys = localeKeys(client, 'ZH');
const enKeys = localeKeys(client, 'EN');
check(zhKeys.size > 0 && enKeys.size > 0, 'both locale dictionaries must be non-empty');
check(zhKeys.size === enKeys.size, 'zh and en dictionaries must have the same key count');
for (const key of zhKeys) check(enKeys.has(key), 'en dictionary is missing key ' + key);
for (const key of enKeys) check(zhKeys.has(key), 'zh dictionary is missing key ' + key);

const metaZh = JSON.parse(read('locale/zh.json'));
const metaEn = JSON.parse(read('locale/en.json'));
check(typeof metaZh.meta?.title === 'string' && metaZh.meta.title.trim() !== '', 'zh meta.title is required');
check(typeof metaZh.meta?.description === 'string' && metaZh.meta.description.trim() !== '', 'zh meta.description is required');
check(typeof metaEn.meta?.title === 'string' && metaEn.meta.title.trim() !== '', 'en meta.title is required');
check(typeof metaEn.meta?.description === 'string' && metaEn.meta.description.trim() !== '', 'en meta.description is required');

const icon = read('icon.svg');
check(icon.trimStart().startsWith('<svg'), 'icon.svg must be an SVG document');
check(Buffer.byteLength(icon) < 256 * 1024, 'icon.svg must stay under 256 KiB');

for (const required of ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'README.md']) {
  check(fs.existsSync(path.join(root, required)), 'missing deliverable file ' + required);
}

if (failures.length > 0) {
  console.error('smoke: FAILED');
  for (const failure of failures) console.error(' - ' + failure);
  process.exit(1);
}
console.log('smoke: OK (' + zhKeys.size + ' locale keys, ' + Buffer.byteLength(client) + ' bytes client)');

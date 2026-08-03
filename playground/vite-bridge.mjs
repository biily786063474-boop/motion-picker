/**
 * 选型台 ↔ LLM 的桥。
 *
 * 选型台是给人用的（看效果、调手感），但调完之后那份「我要这个、参数是这样」
 * 必须能交回给 LLM，由它按目标项目的技术栈去适配和集成。
 * 这个插件就提供那条回流通道，外加一个「这个组件在我的项目里能不能用」的实时体检。
 *
 * POST /api/selection   保存选择 → 写 .rb-selection.json，skill 读它
 * GET  /api/host        宿主体检（?project=<绝对路径>&component=<组件名>）
 * GET  /api/context     当前会话的上下文（宿主是谁、选了什么）
 */
import fs from 'node:fs';
import path from 'node:path';
import { addComponent, getComponent, inspectHost, findProjectRoot, LIB_ROOT } from '../scripts/lib/add-core.mjs';

const SELECTION_FILE = path.join(LIB_ROOT, '.rb-selection.json');
const CONTEXT_FILE = path.join(LIB_ROOT, '.rb-context.json');

const json = (res, code, body) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body, null, 2));
};

const readBody = req =>
  new Promise(resolve => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch {
        resolve({});
      }
    });
  });

export function bridgePlugin() {
  return {
    name: 'reactbits-bridge',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost');
        if (!url.pathname.startsWith('/api/')) return next();

        try {
          /* 当前上下文：这次选型是给哪个项目做的 */
          if (url.pathname === '/api/context' && req.method === 'GET') {
            let ctx = {};
            try {
              ctx = JSON.parse(fs.readFileSync(CONTEXT_FILE, 'utf8'));
            } catch {}
            return json(res, 200, ctx);
          }

          /* 宿主体检：这个组件在目标项目里能不能用 */
          if (url.pathname === '/api/host' && req.method === 'GET') {
            const project = url.searchParams.get('project');
            const name = url.searchParams.get('component');
            const comp = getComponent(name);
            if (!comp) return json(res, 404, { error: `没有组件 ${name}` });
            if (!project) return json(res, 200, { warnings: [], note: '没有指定目标项目，跳过体检' });
            const root = findProjectRoot(project) || project;
            return json(res, 200, { projectRoot: root, warnings: inspectHost(comp, root) });
          }

          /* 保存选择 —— 这就是交给 LLM 的那一下 */
          if (url.pathname === '/api/selection' && req.method === 'POST') {
            const body = await readBody(req);
            const comp = getComponent(body.name);
            if (!comp) return json(res, 404, { error: `没有组件 ${body.name}` });

            let ctx = {};
            try {
              ctx = JSON.parse(fs.readFileSync(CONTEXT_FILE, 'utf8'));
            } catch {}
            const project = body.project || ctx.project || null;
            const root = project ? findProjectRoot(project) || project : null;

            // 把 LLM 做适配需要的东西一次性备齐，省得它再回头翻文件
            const selection = {
              pickedAt: new Date().toISOString(),
              component: {
                name: comp.name,
                category: comp.category,
                url: comp.url,
                localPath: comp.localPath,
                sourcePath: path.join(LIB_ROOT, comp.localPath),
                promptPath: path.join(LIB_ROOT, 'prompts', comp.prompt),
                realDeps: comp.realDeps,
                assets: comp.assets,
                publicAssets: comp.publicAssets,
                remoteUrls: comp.remoteUrls,
                namedExportOnly: comp.namedExportOnly,
                usesTailwind: comp.usesTailwind,
                usesGLTF: comp.usesGLTF
              },
              // 用户在选型台里调出来的那组参数 —— 只有与默认值不同的
              tunedProps: body.tunedProps || {},
              usage: body.usage || '',
              targetProject: root,
              hostWarnings: root ? inspectHost(comp, root) : [],
              addCommand: root
                ? `node ${path.join(LIB_ROOT, 'scripts/add.mjs')} ${comp.name} --to <目标目录>`
                : `node ${path.join(LIB_ROOT, 'scripts/add.mjs')} ${comp.name} --to <目标目录>`
            };

            fs.writeFileSync(SELECTION_FILE, JSON.stringify(selection, null, 2) + '\n');
            return json(res, 200, { ok: true, saved: SELECTION_FILE, selection });
          }

          /* 直接落盘（选型台里点「拷进项目」时用） */
          if (url.pathname === '/api/add' && req.method === 'POST') {
            const body = await readBody(req);
            const result = await addComponent(body);
            return json(res, result.ok ? 200 : 400, result);
          }

          return json(res, 404, { error: 'unknown endpoint' });
        } catch (e) {
          return json(res, 500, { error: e.message });
        }
      });
    }
  };
}

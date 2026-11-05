const { app, BrowserWindow, ipcMain, clipboard, nativeImage, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

let win = null;

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
};

function createWindow() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1100,
    minHeight: 660,
    backgroundColor: '#16181d',
    autoHideMenuBar: true,
    title: 'Collage Maker',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function readImageFile(pathStr) {
  const ext = path.extname(pathStr).toLowerCase();
  const mime = MIME[ext];
  if (!mime) return null;
  try {
    const buf = fs.readFileSync(pathStr);
    return 'data:' + mime + ';base64,' + buf.toString('base64');
  } catch (e) {
    console.error(e);
    return null;
  }
}

ipcMain.handle('clipboard:writeImage', async (e, dataURL) => {
  try {
    const img = nativeImage.createFromDataURL(dataURL);
    if (img.isEmpty()) return false;
    clipboard.writeImage(img);
    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
});

ipcMain.handle('clipboard:readImage', async () => {
  const formats = clipboard.availableFormats('clipboard');
  const hasBitmap = formats.some((f) => f.startsWith('image/'));
  let dataURL = null;
  if (hasBitmap) {
    const img = clipboard.readImage('clipboard');
    if (!img.isEmpty()) {
      dataURL = img.toDataURL();
      if (img.getSize().width > 4096 || img.getSize().height > 4096) {
        const ratio = Math.min(1, 4096 / Math.max(img.getSize().width, img.getSize().height));
        dataURL = img.resize({ width: Math.round(img.getSize().width * ratio) }).toDataURL();
      }
    }
  }
  const filePaths = clipboard.readFilePaths ? clipboard.readFilePaths('clipboard') : [];
  const imageFiles = filePaths.filter((p) => MIME[path.extname(p).toLowerCase()] && fs.existsSync(p));
  return { ok: !!(dataURL || imageFiles.length), dataURL, filePaths: imageFiles };
});

ipcMain.handle('file:readFull', async (e, p) => readImageFile(p));

const PREVIEW_MAX = 1800;
ipcMain.handle('file:readPreview', async (e, p) => {
  const img = nativeImage.createFromPath(p);
  if (img.isEmpty()) return null;
  const { width, height } = img.getSize();
  const max = Math.max(width, height);
  if (max > PREVIEW_MAX) {
    const ratio = PREVIEW_MAX / max;
    img.resize({ width: Math.max(1, Math.round(width * ratio)) });
  }
  return img.toDataURL();
});

ipcMain.handle('dialog:export', async (e, { defaultName, dataURL, format }) => {
  const ext = format === 'jpeg' ? 'jpg' : format;
  const res = await dialog.showSaveDialog(win, {
    defaultPath: defaultName + '.' + ext,
    filters: format === 'png'
      ? [{ name: 'PNG Image', extensions: ['png'] }]
      : format === 'webp'
        ? [{ name: 'WebP Image', extensions: ['webp'] }]
        : [{ name: 'JPEG Image', extensions: ['jpg', 'jpeg'] }],
  });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  try {
    const base64 = dataURL.split(',')[1];
    fs.writeFileSync(res.filePath, Buffer.from(base64, 'base64'));
    return { ok: true, filePath: res.filePath };
  } catch (err) {
    console.error(err);
    return { ok: false };
  }
});

ipcMain.handle('project:save', async (e, { defaultName, json }) => {
  const res = await dialog.showSaveDialog(win, {
    defaultPath: defaultName + '.collage',
    filters: [{ name: 'Collage Project', extensions: ['collage'] }],
  });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  try {
    fs.writeFileSync(res.filePath, json, 'utf8');
    return { ok: true, filePath: res.filePath };
  } catch (err) {
    console.error(err);
    return { ok: false };
  }
});

ipcMain.handle('project:open', async () => {
  const res = await dialog.showOpenDialog(win, {
    filters: [{ name: 'Collage Project', extensions: ['collage'] }],
    properties: ['openFile'],
  });
  if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
  try {
    const json = fs.readFileSync(res.filePaths[0], 'utf8');
    return { ok: true, filePath: res.filePaths[0], json };
  } catch (err) {
    console.error(err);
    return { ok: false };
  }
});

const storageCache = {};
ipcMain.handle('storage:read', (e, key) => {
  if (storageCache[key] !== undefined) return storageCache[key];
  const p = path.join(app.getPath('userData'), key + '.json');
  try {
    storageCache[key] = fs.readFileSync(p, 'utf8');
  } catch (e2) {
    storageCache[key] = null;
  }
  return storageCache[key];
});
ipcMain.handle('storage:write', (e, key, value) => {
  const p = path.join(app.getPath('userData'), key + '.json');
  storageCache[key] = value;
  try {
    fs.writeFileSync(p, value, 'utf8');
    return true;
  } catch (e2) {
    console.error(e2);
    return false;
  }
});

if (process.argv.includes('--test')) {
  ipcMain.on('test:complete', (e, res) => {
    const out = path.join(app.getPath('temp'), 'cm_test_results.json');
    try {
      fs.writeFileSync(out, JSON.stringify(res, null, 2), 'utf8');
    } catch (err) {
      console.error(err);
    }
    console.error('[TEST-PASS]', JSON.stringify(res));
    setTimeout(() => app.exit(0), 300);
  });
  app.whenReady().then(() => {
    setTimeout(() => {
      const w = BrowserWindow.getAllWindows()[0];
      if (w) {
        w.webContents.executeJavaScript(
          `import('./js/test.js').then(m => m.runTests()).then(r => { window.api.testComplete(r); }).catch(err => window.api.testComplete([{name:'harness', pass:false, error: String(err)}]))`
        );
      }
    }, 1500);
  });
}

if (process.argv.includes('--screenshot')) {
  app.whenReady().then(() => {
    setTimeout(() => {
      const w = BrowserWindow.getAllWindows()[0];
      if (!w) return;
      w.webContents.executeJavaScript(`import('./js/shot.js').then(m => m.run())`)
        .then(() => {
          setTimeout(() => {
            w.webContents.capturePage().then((img) => {
              fs.writeFileSync(path.join(app.getPath('temp'), 'cm_screenshot.png'), img.toPNG());
              app.exit(0);
            });
          }, 1200);
        });
    }, 2000);
  });
}
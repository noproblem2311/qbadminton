import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifestVersion: 3,
  manifest: {
    name: 'QBadminton Tracker',
    description:
      'Theo dõi bài tuyển vãng lai cầu lông trong các nhóm Facebook bạn đang mở và gửi về máy chủ QBadminton.',
    permissions: ['storage', 'alarms', 'scripting'],
    host_permissions: [
      'https://www.facebook.com/*',
      'https://web.facebook.com/*',
      'https://qbadminton.quanphung.space/*',
      'http://localhost/*',
      'http://127.0.0.1/*',
    ],
    // Requested at runtime only if the user points the extension at another backend.
    optional_host_permissions: ['https://*/*', 'http://*/*'],
  },
});

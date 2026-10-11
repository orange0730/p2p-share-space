import { Capacitor } from '@capacitor/core';

/** 是否在 Capacitor 包裝的原生 App 裡執行（網頁版永遠是 false） */
export const isNativeApp = () => Capacitor.isNativePlatform();

/**
 * 公開網址：原生 App 的 origin 是 capacitor://localhost，不能拿來產生 QR Code，
 * 配對連結一律指向網頁版（之後設定 Universal Links，iPhone 掃碼就會直接開 App）。
 */
export const PUBLIC_URL = import.meta.env.VITE_PUBLIC_URL || 'https://wudodo.me/p2p-share-space/';

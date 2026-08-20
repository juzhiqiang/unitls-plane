import { getLimit } from '@utils-plane/utils';
import {
  getEntitlementUserFromSession,
  type EntitlementSession,
} from '@/lib/entitlement-session';

/**
 * 图片工具的输入体积上限。
 *
 * 分两类,不是同一件事:
 *
 * - **会上传服务端的工具**(压缩/转换/水印/证件照)受账号额度约束,走 upload.maxFileSize。
 * - **纯本地工具**(裁剪/抠图/打码)从不上传,体积上限是「浏览器解码这张图会不会把
 *   内存撑爆」的护栏,与账号无关。给它们套账号额度反而会把匿名用户从 50MB 砍到 10MB,
 *   而这条限制本来就不该存在 —— 图片根本没离开过浏览器。
 *
 * 此前六个页面各自硬编码 `50 * 1024 * 1024`,把这两种语义混为一谈。
 */

/**
 * 纯本地处理的单文件上限。
 *
 * 取 50MB:一张 50MB 的 JPEG 解码后约 400MB 位图(按 1 亿像素 ×4 通道估),已经接近
 * 移动端浏览器的承受边界,再大很容易直接崩标签页。
 */
export const LOCAL_IMAGE_MAX_FILE_SIZE = 50 * 1024 * 1024;

/** 会上传服务端的工具:按账号额度。 */
export function getImageUploadMaxFileSize(session: EntitlementSession): number {
  return getLimit(getEntitlementUserFromSession(session), 'upload.maxFileSize');
}

import { createToolMetadataGenerator } from '@/lib/tools/tool-route-metadata';

export const generateMetadata = createToolMetadataGenerator('/image/try-on');

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

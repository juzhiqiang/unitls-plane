import {
  createToolMetadataGenerator,
  ToolMetadataLayout,
} from '@/lib/tools/tool-route-metadata';

export const generateMetadata = createToolMetadataGenerator('/image/convert');

export default ToolMetadataLayout;

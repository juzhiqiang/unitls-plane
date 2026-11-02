import {
  createToolMetadataGenerator,
  ToolMetadataLayout,
} from '@/lib/tools/tool-route-metadata';

export const generateMetadata = createToolMetadataGenerator('/image/try-on');

export default ToolMetadataLayout;

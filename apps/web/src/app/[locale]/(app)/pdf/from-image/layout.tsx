import {
  createToolMetadataGenerator,
  ToolMetadataLayout,
} from '@/lib/tools/tool-route-metadata';

export const generateMetadata = createToolMetadataGenerator('/pdf/from-image');

export default ToolMetadataLayout;

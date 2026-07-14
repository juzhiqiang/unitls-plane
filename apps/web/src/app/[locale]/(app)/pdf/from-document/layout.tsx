import {
  createToolMetadataGenerator,
  ToolMetadataLayout,
} from '@/lib/tools/tool-route-metadata';

export const generateMetadata =
  createToolMetadataGenerator('/pdf/from-document');

export default ToolMetadataLayout;

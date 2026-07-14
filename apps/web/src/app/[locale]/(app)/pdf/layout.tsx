import {
  createCategoryMetadataGenerator,
  ToolMetadataLayout,
} from '@/lib/tools/tool-route-metadata';

export const generateMetadata = createCategoryMetadataGenerator('pdf');

export default ToolMetadataLayout;

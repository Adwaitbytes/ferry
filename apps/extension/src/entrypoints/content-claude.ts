import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { runContent } from '../content/entry';

/**
 * Content script for claude. Registered in manifest.config.ts with all_frames false. Built as an
 * unlisted script so WXT's content-script context, which posts window messages, is not bundled (RT-39).
 */
export default defineUnlistedScript(() => runContent('claude'));

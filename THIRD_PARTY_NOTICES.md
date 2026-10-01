# Third-party notices

## NyaNovel

Sakura NAI is derived from [NyaNovel](https://github.com/Nya-Foundation/NyaNovel).
The original MIT copyright and license are retained in [LICENSE](LICENSE).

Copyright (c) 2025 Nya Foundation

Sakura NAI has its own name, cherry blossom artwork, interface customizations,
and application-owned NovelAI request implementation. The upstream attribution
does not imply that the original authors maintain or endorse this fork.

## Aaalice_NAI_Launcher

The modern Anlas pricing logic in lib/nai/cost.ts is adapted from Aaalice_NAI_Launcher (MIT), including the V5 1.5 multiplier, rounding order, first-sample Opus discount, allowance status, subscription validity, reference surcharges, and the expanded billing canvas for Enhance Max. The enhancement levels and size handling in lib/nai/image-tools.ts also refer to that project's official-client compatibility constants and tests.

Source: https://github.com/Aaalice233/Aaalice_NAI_Launcher/blob/main/lib/core/services/anlas_calculator.dart

Enhancement constants: https://github.com/Aaalice233/Aaalice_NAI_Launcher/blob/main/lib/core/constants/api_constants.dart

Enhancement billing: https://github.com/Aaalice233/Aaalice_NAI_Launcher/blob/main/lib/presentation/providers/cost_estimate_provider.dart

The canvas crop/expansion, focused inpainting workflow, Variety+ sigma scaling, and Opus small-image upscale discount were also checked against this project's implementation at commit c648ee60316e58a5ec45c539e28023f8a56c2db7. The browser canvas implementation is application-owned; its source references are lib/core/utils/inpaint_outpaint_utils.dart, lib/core/utils/focused_inpaint_utils.dart, lib/core/network/request_builders/nai_image_request_builder.dart, and lib/core/services/anlas_calculator.dart.

The application-owned inpainting mask preparation and result compositor also refer to the public request-mask workflow in lib/core/utils/inpaint_mask/inpaint_mask_operations.dart (8px latent-grid sampling, opaque black/white full-size request masks, and client-side result composition). The regular workflow uses the same binary request mask for composition; it does not reproduce that project's dilated soft composite mask.

MIT License

Copyright (c) 2026 NAI Launcher Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

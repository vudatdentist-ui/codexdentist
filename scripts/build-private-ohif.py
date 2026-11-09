#!/usr/bin/env python3
"""Build the pinned official OHIF viewer at the authenticated app subpath.

The small responsive adaptation collapses side panels on narrow displays and
puts the full tool strip on a separate scrollable row. No imaging/data-source,
onboarding, licensing or investigational-use checks are removed.
"""
import argparse
from pathlib import Path
import subprocess

COMMIT = 'e4cd86153a1aaa429ef749330eaeefd4df96a88a'
IMAGE = 'codexdentist-ohif:e4cd861-responsive1'
REPLACEMENTS = {
 'platform/ui-next/src/components/Header/Header.tsx': [
  ('className="relative h-[48px] items-center"', 'className="relative h-[96px] items-center md:h-[48px]"'),
  ('<div className="ml-1">', '<span className="text-primary px-2 text-sm font-medium md:hidden">OHIF</span>\n              <div className="ml-1 hidden md:block">'),
  ('className="absolute top-1/2 left-[250px] h-8 -translate-y-1/2"', 'className="absolute top-1/2 left-[250px] hidden h-8 -translate-y-1/2 md:block"'),
  ('className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 transform"',
   'className="absolute inset-x-0 top-[52px] h-9 overflow-x-auto md:inset-x-auto md:left-1/2 md:top-1/2 md:h-auto md:-translate-x-1/2 md:-translate-y-1/2"'),
  ('className="flex items-center justify-center space-x-2"', 'className="flex w-max items-center justify-center space-x-2 px-2 md:w-auto md:px-0"'),
 ],
 'extensions/default/src/ViewerLayout/index.tsx': [
  ('className="relative flex w-full flex-row flex-nowrap items-stretch overflow-hidden bg-background"\n        style={{ height: \'calc(100vh - 52px)\' }}',
   'className="relative flex h-[calc(100dvh-100px)] w-full flex-row flex-nowrap items-stretch overflow-hidden bg-background md:h-[calc(100vh-52px)]"'),
 ],
 'extensions/default/src/ViewerLayout/ResizablePanelsHook.tsx': [
  ('  // This useLayoutEffect follows the pattern prescribed by the react-resizable-panels',
   '''  // Codexdentist: keep the image viewport usable when the display narrows.
  // Use the panel API so React state, layout percentages and pixel bounds agree.
  useLayoutEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const collapseForNarrowScreen = () => {
      if (!media.matches) return;
      setLeftPanelClosed(true);
      setRightPanelClosed(true);
      setMinMaxWidth(resizableLeftPanelElemRef.current);
      setMinMaxWidth(resizableRightPanelElemRef.current);
      resizableLeftPanelAPIRef.current?.collapse();
      resizableRightPanelAPIRef.current?.collapse();
    };
    collapseForNarrowScreen();
    media.addEventListener('change', collapseForNarrowScreen);
    return () => media.removeEventListener('change', collapseForNarrowScreen);
  }, [setLeftPanelClosed, setRightPanelClosed]);

  // This useLayoutEffect follows the pattern prescribed by the react-resizable-panels'''),
 ],
}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',default='/opt/codexdentist-optional/ohif-source')
    parser.add_argument('--prepare-only',action='store_true')
    args = parser.parse_args()
    source = Path(args.source).resolve()
    if not source.exists():
        subprocess.run(['git','clone','--depth','1','--branch','v3.13.14','https://github.com/OHIF/Viewers.git',str(source)],check=True)
    revision = subprocess.run(['git','-C',str(source),'rev-parse','HEAD'],check=True,capture_output=True,text=True).stdout.strip()
    if revision != COMMIT:
        raise SystemExit('Unexpected OHIF source revision; review the upstream change first.')
    for relative, replacements in REPLACEMENTS.items():
        file = source/relative
        text = file.read_text()
        for before, after in replacements:
            if text.count(after) == 1:
                continue
            if text.count(before) != 1:
                raise SystemExit('Unexpected source context: '+relative)
            text = text.replace(before,after)
        file.write_text(text)
    if args.prepare_only:
        print('Pinned OHIF responsive source prepared.')
        return
    builder = 'codexdentist-ohif-builder'
    inspected = subprocess.run(['docker','buildx','inspect',builder],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    if inspected.returncode:
        subprocess.run(['docker','buildx','create','--name',builder,'--driver','docker-container',
            '--driver-opt','memory=4g,cpu-period=100000,cpu-quota=200000'],check=True)
    subprocess.run(['docker','buildx','build','--builder',builder,'--load','--build-arg','PUBLIC_URL=/imaging/ohif/',
        '--label','org.opencontainers.image.revision='+COMMIT,'--label','com.codexdentist.ohif-layout=responsive1',
        '--tag',IMAGE,str(source)],check=True)
    print('Private OHIF image built:',IMAGE)

if __name__ == '__main__':
    main()

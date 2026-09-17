import hashlib, importlib.util, io, pathlib, tarfile, tempfile, unittest
spec=importlib.util.spec_from_file_location('archive',pathlib.Path(__file__).with_name('archive.py'))
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
class ArchivePaths(unittest.TestCase):
 def reject(self, entries):
  with tempfile.TemporaryDirectory(dir='test-artifacts/security') as td:
   root=pathlib.Path(td);src=root/'bad.tar.gz';dest=root/'out';dest.mkdir()
   with tarfile.open(src,'w:gz') as t:
    for name,kind,target in entries:
     info=tarfile.TarInfo(name)
     if kind=='link': info.type=tarfile.SYMTYPE;info.linkname=target
     elif kind=='hard': info.type=tarfile.LNKTYPE;info.linkname=target
     elif kind=='device': info.type=tarfile.CHRTYPE
     else: info.size=1
     t.addfile(info,io.BytesIO(b'x') if info.isfile() else None)
   with self.assertRaises(ValueError): a.extract(src,hashlib.sha256(src.read_bytes()).hexdigest(),dest)
   self.assertEqual(list(dest.iterdir()),[],'Reject before first payload write')
 def test_traversal(self): self.reject([('../outside','file','')])
 def test_absolute(self): self.reject([('/outside','file','')])
 def test_link_escape(self): self.reject([('dist/x','link','../../outside')])
 def test_link_parent(self): self.reject([('dist/x','link','../node_modules'),('dist/x/a','file','')])
 def test_hardlink(self): self.reject([('dist/x','hard','dist/index.html')])
 def test_device(self): self.reject([('dist/x','device','')])
 def test_duplicate(self): self.reject([('dist/a','file',''),('dist/a','file','')])
 def test_secret(self): self.reject([('dist/.env','file','')])
 def test_qa(self): self.reject([('dist/qa-network.html','file','')])
if __name__=='__main__': unittest.main()

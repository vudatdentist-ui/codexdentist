import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('acceptance',Path(__file__).with_name('owned-signing-core-acceptance.py'))
acceptance=importlib.util.module_from_spec(spec);spec.loader.exec_module(acceptance)


class ActualCoreAcceptance(unittest.TestCase):
    def fixture(self):
        return {'formCompleted':True,'signedFiles':1,'signedAudits':1,'journeyComments':1,
            'providerEnvelopeCompleted':True,'providerRecipientSigned':True,'successfulProviderCalls':3,
            'processedCoreEvents':3,'foreignRows':0,'sourceAndSignedScopeMatch':True,'sourceReferenceMatches':True,
            'signedSha256':'a'*64,'signedBytes':123456,'storageKey':'patient-files/synthetic-org/synthetic-patient/file.pdf'}

    def test_missing_or_duplicate_domain_events_cannot_satisfy_real_ceremony_acceptance(self):
        original=self.fixture();acceptance.validate(original)
        for key,bad in [('formCompleted',False),('signedFiles',2),('signedAudits',0),('journeyComments',2),
            ('providerEnvelopeCompleted',False),('providerRecipientSigned',False),('successfulProviderCalls',0),
            ('processedCoreEvents',1),('foreignRows',1),('sourceAndSignedScopeMatch',False),('sourceReferenceMatches',False),
            ('signedFiles',True),('signedSha256','invalid'),('storageKey','patient-files/../foreign/file.pdf'),('signedBytes',0)]:
            with self.subTest(key=key,bad=bad),self.assertRaises(ValueError):acceptance.validate({**original,key:bad})

    def test_invalid_pdf_coverage_fails_before_any_crypto_command(self):
        for value in [b'not a PDF',b'%PDF- /ByteRange [0 1 3 9000] <1234>']:
            with self.assertRaises(ValueError):acceptance.verify_pdf(value,Path('unused'))


if __name__=='__main__':unittest.main()

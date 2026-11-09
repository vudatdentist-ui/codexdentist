import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('local_ai_services',Path(__file__).with_name('local-ai-services.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class LocalInferenceDeploymentTests(unittest.TestCase):
    def test_unpinned_images_fail_before_configuration(self):
        for image in ['ollama/ollama:latest','ollama/ollama:0.40.15','foreign/image@sha256:'+'a'*64]:
            with self.assertRaises(AssertionError):module.configuration(image)

    def test_runtime_cannot_reach_cloud_or_persist_prompt_history_in_model_storage(self):
        config=module.configuration('ollama/ollama@sha256:'+'a'*64)
        self.assertEqual(config['networks'],{'private':{'internal':True}})
        service=config['services']['ollama']
        self.assertEqual(service['environment']['OLLAMA_NO_CLOUD'],'1')
        self.assertTrue(service['read_only'])
        self.assertEqual(service['volumes'],['models:/root/.ollama:ro'])
        self.assertNotIn('ports',service)
        self.assertEqual(service['cap_drop'],['ALL'])
        self.assertEqual(service['profiles'],['local-ai'])
        self.assertEqual(service['cpus'],3)
        self.assertEqual(service['mem_limit'],'5g')
        self.assertEqual(service['environment']['OLLAMA_NUM_PARALLEL'],'1')
        self.assertEqual(service['environment']['OLLAMA_MAX_QUEUE'],'2')
        self.assertNotIn('DATABASE_URL',service['environment'])
        self.assertNotIn('API_KEY',str(service['environment']))

if __name__=='__main__':unittest.main()

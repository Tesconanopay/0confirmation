from os.path import realpath, dirname, join, splitext
from vyper import compile_code
import json

CONTRACT_PATH = join(dirname(dirname(realpath(__file__))), 'vyper')
compiled_contracts = {}


def deploy_contract(w3, name, filename, replacements=None):
    save_name = name
    if isinstance(filename, list):
        interface_files = filename[1:]
        filename = filename[0]
    else:
        interface_files = []

    with open(join(CONTRACT_PATH, filename)) as f:
        source = f.read()
    if replacements:
        for k, v in replacements.items():
            source = source.replace(k, v)
    interface_codes = {}
    for i in interface_files:
        name = splitext(i)[0]
        with open(join(CONTRACT_PATH, i)) as f:
            interface_codes[name] = {
                    'type': 'vyper',
                    'code': f.read()}

    if filename in compiled_contracts:
        code = compiled_contracts[filename]
    else:
        code = compile_code(source, ['bytecode', 'abi'],
                            interface_codes=interface_codes or None)
    code['contractName'] = save_name
    print(json.dumps(code))
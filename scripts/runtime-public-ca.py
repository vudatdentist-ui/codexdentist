"""Forward only the reviewed read-only public CA to an independent app verifier."""

SOURCE = '/opt/codexdentist-owned-mail/core-trust/gateway.cert.pem'
TARGET = '/run/codexdentist-mail-ca.pem'


def public_ca_arguments(current):
    environment = dict(value.split('=', 1) for value in current['Config']['Env'])
    value = environment.get('NODE_EXTRA_CA_CERTS')
    if not value: return []
    if value != TARGET: raise ValueError('Review a new runtime CA explicitly before forwarding it')
    mounts = [row for row in current['Mounts'] if row['Destination'] == TARGET]
    if len(mounts) != 1 or mounts[0]['Type'] != 'bind' or mounts[0]['Source'] != SOURCE or mounts[0]['RW']:
        raise ValueError('Exact read-only public gateway CA mount required')
    return ['--mount', 'type=bind,source=' + SOURCE + ',target=' + TARGET + ',readonly']
